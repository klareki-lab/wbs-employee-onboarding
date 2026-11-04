-- Trade Fair Assistant: durable processing and sales-notification queues.
-- PostgreSQL 14+ / Neon-compatible; apply AFTER trade_fair_schema.sql.
-- This additive migration preserves WF-A, its raw submissions and receipts.
-- No provider credentials, real recipients or environment names are included.
-- New queue functions use hardened SECURITY DEFINER with EXECUTE-only roles.
-- Apply as a trusted migration owner; keep CREATE on this schema owner-only.
-- The original WF-A capture function remains SECURITY INVOKER.

BEGIN;

DO $check$
BEGIN
    IF to_regclass('trade_fair.lead_submissions') IS NULL
       OR to_regprocedure('trade_fair.capture_lead(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Apply trade_fair_schema.sql before migration 002_processing';
    END IF;
END;
$check$;

CREATE TABLE IF NOT EXISTS trade_fair.schema_migrations (
    version text PRIMARY KEY,
    description text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $version$
BEGIN
    IF EXISTS (SELECT 1 FROM trade_fair.schema_migrations WHERE version = '002_processing') THEN
        RAISE NOTICE '002_processing already recorded; reasserting additive definitions without resetting data';
    END IF;
END;
$version$;

ALTER TABLE trade_fair.lead_submissions
    ADD COLUMN IF NOT EXISTS processing_cycle_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS processing_cycle_attempts integer NOT NULL DEFAULT 0 CHECK (processing_cycle_attempts >= 0),
    ADD COLUMN IF NOT EXISTS processing_max_attempts integer NOT NULL DEFAULT 5 CHECK (processing_max_attempts BETWEEN 1 AND 20),
    ADD COLUMN IF NOT EXISTS processing_next_retry_at timestamptz DEFAULT clock_timestamp(),
    ADD COLUMN IF NOT EXISTS processing_lease_token uuid,
    ADD COLUMN IF NOT EXISTS processing_lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS processing_worker_id varchar(128),
    ADD COLUMN IF NOT EXISTS processing_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS processing_ready_queue
    ON trade_fair.lead_submissions (processing_next_retry_at, persisted_at)
    WHERE processing_status = 'pending';
CREATE INDEX IF NOT EXISTS processing_expired_leases
    ON trade_fair.lead_submissions (processing_lease_expires_at)
    WHERE processing_status = 'processing';

-- Only the hardened functions can access results on behalf of the worker.
-- The completion token also makes a lost finish response safe to retry.
CREATE TABLE IF NOT EXISTS trade_fair.processing_results (
    lead_id text PRIMARY KEY REFERENCES trade_fair.lead_submissions(lead_id),
    completion_token uuid NOT NULL UNIQUE,
    result_payload jsonb NOT NULL CHECK (
        jsonb_typeof(result_payload) = 'object' AND octet_length(result_payload::text) <= 262144
    ),
    notification_payload jsonb NOT NULL CHECK (
        jsonb_typeof(notification_payload) = 'object' AND octet_length(notification_payload::text) <= 262144
    ),
    score_total smallint NOT NULL CHECK (score_total BETWEEN 0 AND 100),
    score_band text NOT NULL CHECK (score_band IN ('HOT', 'WARM', 'COLD')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS trade_fair.email_outbox (
    outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id text NOT NULL UNIQUE REFERENCES trade_fair.processing_results(lead_id),
    idempotency_key text NOT NULL UNIQUE,
    sender text NOT NULL CHECK (char_length(sender) BETWEEN 3 AND 254),
    recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 254),
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 240),
    text_body text NOT NULL CHECK (char_length(text_body) BETWEEN 1 AND 60000),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'leased', 'sending', 'delivered', 'uncertain', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    cycle_id uuid NOT NULL DEFAULT gen_random_uuid(),
    cycle_attempts integer NOT NULL DEFAULT 0 CHECK (cycle_attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    next_retry_at timestamptz DEFAULT clock_timestamp(),
    lease_token uuid,
    lease_expires_at timestamptz,
    worker_id varchar(128),
    delivery_token uuid,
    provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 512),
    delivered_at timestamptz,
    last_error_code varchar(64),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS email_ready_queue
    ON trade_fair.email_outbox (next_retry_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_expired_leases
    ON trade_fair.email_outbox (lease_expires_at) WHERE status IN ('leased', 'sending');

-- Transition evidence contains codes and operator explanations, not provider
-- error bodies, notes, research snippets, recipient addresses or credentials.
CREATE TABLE IF NOT EXISTS trade_fair.job_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id text NOT NULL REFERENCES trade_fair.lead_submissions(lead_id),
    outbox_id uuid REFERENCES trade_fair.email_outbox(outbox_id),
    event_kind varchar(64) NOT NULL,
    attempt integer NOT NULL CHECK (attempt >= 0),
    cycle_id uuid NOT NULL,
    lease_token uuid,
    actor varchar(128),
    error_code varchar(64),
    operator_note text CHECK (operator_note IS NULL OR char_length(operator_note) <= 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS job_events_lead_history ON trade_fair.job_events (lead_id, created_at);
CREATE INDEX IF NOT EXISTS job_events_email_history ON trade_fair.job_events (outbox_id, created_at)
    WHERE outbox_id IS NOT NULL;

-- CLAIM PROCESSING ----------------------------------------------------------
-- Schedule this function periodically. It also recovers abandoned attempts.
-- One new opaque lease token fences each attempt; no worker holds a DB
-- transaction open while calling research or AI providers.
CREATE OR REPLACE FUNCTION trade_fair.claim_processing(
    p_worker_id text, p_limit integer DEFAULT 1,
    p_lease_seconds integer DEFAULT 180, p_max_attempts integer DEFAULT 5
)
RETURNS TABLE (
    lead_id text, lease_token uuid, lease_expires_at timestamptz,
    attempt integer, wf_b_payload jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, trade_fair, pg_temp
AS $function$
DECLARE
    job trade_fair.lead_submissions%ROWTYPE;
    claimed trade_fair.lead_submissions%ROWTYPE;
    stamp timestamptz;
BEGIN
    IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 128
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 900
       OR p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid processing claim parameters';
    END IF;

    -- A final attempt that crashed must become visible as failed, not remain
    -- permanently "processing". SKIP LOCKED avoids blocking another owner.
    FOR job IN
        SELECT s.* FROM trade_fair.lead_submissions s
        WHERE s.processing_status IN ('pending', 'processing')
          AND s.processing_cycle_attempts >= s.processing_max_attempts
          AND (s.processing_status = 'pending'
               OR s.processing_lease_expires_at IS NULL
               OR s.processing_lease_expires_at <= clock_timestamp())
        ORDER BY s.persisted_at FOR UPDATE OF s SKIP LOCKED LIMIT 100
    LOOP
        UPDATE trade_fair.lead_submissions s SET
            processing_status='failed', last_error_code='PROCESSING_RETRY_EXHAUSTED',
            processing_lease_token=NULL, processing_lease_expires_at=NULL,
            processing_worker_id=NULL, processing_next_retry_at=NULL,
            processing_updated_at=clock_timestamp()
        WHERE s.lead_id=job.lead_id;
        INSERT INTO trade_fair.job_events (lead_id,event_kind,attempt,cycle_id,lease_token,actor,error_code)
        VALUES (job.lead_id,'processing_exhausted',job.processing_attempts,
                job.processing_cycle_id,job.processing_lease_token,p_worker_id,'PROCESSING_RETRY_EXHAUSTED');
    END LOOP;

    FOR job IN
        SELECT s.* FROM trade_fair.lead_submissions s
        WHERE s.processing_cycle_attempts < s.processing_max_attempts
          AND ((s.processing_status='pending'
                AND COALESCE(s.processing_next_retry_at,s.persisted_at) <= clock_timestamp())
            OR (s.processing_status='processing'
                AND (s.processing_lease_expires_at IS NULL
                     OR s.processing_lease_expires_at <= clock_timestamp())))
        ORDER BY COALESCE(s.processing_next_retry_at,s.persisted_at),s.persisted_at,s.lead_id
        FOR UPDATE OF s SKIP LOCKED LIMIT p_limit
    LOOP
        IF job.processing_status='processing' THEN
            INSERT INTO trade_fair.job_events (lead_id,event_kind,attempt,cycle_id,lease_token,actor,error_code)
            VALUES (job.lead_id,'processing_lease_expired',job.processing_attempts,
                    job.processing_cycle_id,job.processing_lease_token,p_worker_id,'PROCESSING_LEASE_EXPIRED');
        END IF;
        stamp := clock_timestamp();
        UPDATE trade_fair.lead_submissions s SET
            processing_status='processing', processing_attempts=s.processing_attempts+1,
            processing_cycle_attempts=s.processing_cycle_attempts+1,
            processing_max_attempts=CASE WHEN s.processing_cycle_attempts=0 THEN p_max_attempts ELSE s.processing_max_attempts END,
            processing_lease_token=gen_random_uuid(),
            processing_lease_expires_at=stamp+make_interval(secs=>p_lease_seconds),
            processing_worker_id=p_worker_id, processing_started_at=stamp,
            processing_next_retry_at=NULL, processing_updated_at=stamp
        WHERE s.lead_id=job.lead_id RETURNING s.* INTO claimed;
        INSERT INTO trade_fair.job_events (lead_id,event_kind,attempt,cycle_id,lease_token,actor)
        VALUES (claimed.lead_id,'processing_claimed',claimed.processing_attempts,
                claimed.processing_cycle_id,claimed.processing_lease_token,p_worker_id);
        lead_id:=claimed.lead_id; lease_token:=claimed.processing_lease_token;
        lease_expires_at:=claimed.processing_lease_expires_at;
        attempt:=claimed.processing_attempts; wf_b_payload:=claimed.wf_b_payload;
        RETURN NEXT;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.renew_processing(
    p_lead_id text, p_lease_token uuid, p_lease_seconds integer DEFAULT 180
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE expiry timestamptz;
BEGIN
    IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid lease duration';
    END IF;
    UPDATE trade_fair.lead_submissions s SET
        processing_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
        processing_updated_at=clock_timestamp()
    WHERE s.lead_id=p_lead_id AND s.processing_status='processing'
      AND s.processing_lease_token=p_lease_token
      AND s.processing_lease_expires_at>clock_timestamp()
    RETURNING s.processing_lease_expires_at INTO expiry;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','STALE_LEASE'); END IF;
    RETURN jsonb_build_object('ok',true,'code','LEASE_RENEWED','lease_expires_at',expiry);
END;
$function$;

-- FINISH PROCESSING ---------------------------------------------------------
-- Result, sales email and completion state commit together. Research/model
-- failure before this call leaves the original submission untouched.
CREATE OR REPLACE FUNCTION trade_fair.finish_processing(
    p_lead_id text, p_lease_token uuid, p_result jsonb, p_email jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE
    job trade_fair.lead_submissions%ROWTYPE;
    existing trade_fair.processing_results%ROWTYPE;
    outbox uuid;
    total integer;
    stamp timestamptz;
BEGIN
    IF jsonb_typeof(p_result) IS DISTINCT FROM 'object'
       OR p_result->>'contract_version' IS DISTINCT FROM '2.0'
       OR jsonb_typeof(p_result->'extraction') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_result->'company_research') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_result->'score') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_result->'uncertainty_flags') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_result#>'{score,breakdown}') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_result#>'{score,total}') IS DISTINCT FROM 'number'
       OR COALESCE(p_result#>>'{score,total}','') !~ '^(0|[1-9][0-9]{0,2})$'
       OR p_result#>>'{score,band}' IS NULL
       OR p_result#>>'{score,band}' NOT IN ('HOT','WARM','COLD')
       OR p_result#>>'{score,version}' IS DISTINCT FROM '1.0'
       OR octet_length(p_result::text)>262144 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid processing result contract';
    END IF;
    total := (p_result#>>'{score,total}')::integer;
    IF total NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Score must be an integer from 0 to 100';
    END IF;
    IF jsonb_typeof(p_email) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_email->'sender') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_email->'recipient') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_email->'subject') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_email->'text_body') IS DISTINCT FROM 'string'
       OR char_length(p_email->>'sender') NOT BETWEEN 3 AND 254
       OR p_email->>'sender' !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
       OR char_length(p_email->>'recipient') NOT BETWEEN 3 AND 254
       OR p_email->>'recipient' !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
       OR char_length(p_email->>'subject') NOT BETWEEN 1 AND 240
       OR strpos(p_email->>'subject',chr(10))>0 OR strpos(p_email->>'subject',chr(13))>0
       OR char_length(p_email->>'text_body') NOT BETWEEN 1 AND 60000
       OR octet_length(p_email::text)>262144
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_email) k(key)
                  WHERE k.key NOT IN ('sender','recipient','subject','text_body')) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid server-configured sales email';
    END IF;

    SELECT s.* INTO job FROM trade_fair.lead_submissions s WHERE s.lead_id=p_lead_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT r.* INTO existing FROM trade_fair.processing_results r WHERE r.lead_id=p_lead_id;
    IF FOUND THEN
        IF existing.completion_token=p_lease_token THEN
            IF existing.result_payload=p_result AND existing.notification_payload=p_email THEN
                SELECT e.outbox_id INTO outbox FROM trade_fair.email_outbox e WHERE e.lead_id=p_lead_id;
                RETURN jsonb_build_object('ok',true,'code','REPLAYED','lead_id',p_lead_id,
                    'processing_status','completed','outbox_id',outbox,'idempotent_replay',true);
            END IF;
            RETURN jsonb_build_object('ok',false,'code','RESULT_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE');
    END IF;
    IF job.processing_status<>'processing' OR job.processing_lease_token IS DISTINCT FROM p_lease_token
       OR job.processing_lease_expires_at IS NULL OR job.processing_lease_expires_at<=clock_timestamp() THEN
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE');
    END IF;

    stamp:=clock_timestamp(); outbox:=gen_random_uuid();
    INSERT INTO trade_fair.processing_results
        (lead_id,completion_token,result_payload,notification_payload,score_total,score_band)
    VALUES (p_lead_id,p_lease_token,p_result,p_email,total,p_result#>>'{score,band}');
    INSERT INTO trade_fair.email_outbox
        (outbox_id,lead_id,idempotency_key,sender,recipient,subject,text_body)
    VALUES (outbox,p_lead_id,'trade-fair-sales-'||outbox::text,
            p_email->>'sender',p_email->>'recipient',p_email->>'subject',p_email->>'text_body');
    UPDATE trade_fair.lead_submissions s SET
        processing_status='completed',processed_at=stamp,last_error_code=NULL,
        processing_lease_token=NULL,processing_lease_expires_at=NULL,processing_worker_id=NULL,
        processing_next_retry_at=NULL,processing_updated_at=stamp
    WHERE s.lead_id=p_lead_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor)
    VALUES (p_lead_id,outbox,'processing_completed',job.processing_attempts,
            job.processing_cycle_id,p_lease_token,job.processing_worker_id);
    RETURN jsonb_build_object('ok',true,'code','COMPLETED','lead_id',p_lead_id,
        'processing_status','completed','outbox_id',outbox,'idempotent_replay',false);
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.fail_processing(
    p_lead_id text,p_lease_token uuid,p_error_code text,p_retryable boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE
    job trade_fair.lead_submissions%ROWTYPE;
    next_status text; retry_at timestamptz; delay_seconds integer;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$' OR p_retryable IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Use a bounded error code, not a provider error body';
    END IF;
    SELECT s.* INTO job FROM trade_fair.lead_submissions s WHERE s.lead_id=p_lead_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.processing_status<>'processing' OR job.processing_lease_token IS DISTINCT FROM p_lease_token
       OR job.processing_lease_expires_at IS NULL OR job.processing_lease_expires_at<=clock_timestamp() THEN
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE');
    END IF;
    IF p_retryable AND job.processing_cycle_attempts<job.processing_max_attempts THEN
        next_status:='pending';
        delay_seconds:=LEAST(3600,30*power(2,LEAST(GREATEST(job.processing_cycle_attempts-1,0),7))::integer);
        retry_at:=clock_timestamp()+make_interval(secs=>delay_seconds);
    ELSE next_status:='failed'; retry_at:=NULL; END IF;
    UPDATE trade_fair.lead_submissions s SET
        processing_status=next_status,last_error_code=p_error_code,processing_next_retry_at=retry_at,
        processing_lease_token=NULL,processing_lease_expires_at=NULL,processing_worker_id=NULL,
        processing_updated_at=clock_timestamp()
    WHERE s.lead_id=p_lead_id;
    INSERT INTO trade_fair.job_events (lead_id,event_kind,attempt,cycle_id,lease_token,actor,error_code)
    VALUES (p_lead_id,CASE WHEN next_status='pending' THEN 'processing_retry_scheduled' ELSE 'processing_failed' END,
            job.processing_attempts,job.processing_cycle_id,p_lease_token,job.processing_worker_id,p_error_code);
    RETURN jsonb_build_object('ok',true,'code',CASE WHEN next_status='pending' THEN 'RETRY_SCHEDULED' ELSE 'FAILED' END,
        'lead_id',p_lead_id,'processing_status',next_status,'next_retry_at',retry_at);
END;
$function$;

-- CLAIM EMAIL ---------------------------------------------------------------
-- An expired lease BEFORE begin_email_send is safe to retry. Once sending has
-- begun, an absent provider acknowledgement is ambiguous: it never resends
-- automatically, even if a provider is believed to support idempotency.
CREATE OR REPLACE FUNCTION trade_fair.claim_email(
    p_worker_id text,p_limit integer DEFAULT 1,
    p_lease_seconds integer DEFAULT 120,p_max_attempts integer DEFAULT 5
) RETURNS TABLE (
    outbox_id uuid,lead_id text,lease_token uuid,lease_expires_at timestamptz,
    attempt integer,idempotency_key text,sender text,recipient text,subject text,text_body text
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE
    job trade_fair.email_outbox%ROWTYPE;
    claimed trade_fair.email_outbox%ROWTYPE;
    next_status text; code text; stamp timestamptz;
BEGIN
    IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 128
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 900
       OR p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid email claim parameters';
    END IF;
    FOR job IN
        SELECT e.* FROM trade_fair.email_outbox e
        WHERE e.status IN ('leased','sending')
          AND (e.lease_expires_at IS NULL OR e.lease_expires_at<=clock_timestamp())
        ORDER BY e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT 100
    LOOP
        IF job.status='sending' THEN next_status:='uncertain'; code:='EMAIL_DELIVERY_UNCERTAIN';
        ELSIF job.cycle_attempts>=job.max_attempts THEN next_status:='failed'; code:='EMAIL_RETRY_EXHAUSTED';
        ELSE next_status:='pending'; code:='EMAIL_LEASE_EXPIRED'; END IF;
        UPDATE trade_fair.email_outbox e SET status=next_status,last_error_code=code,
            lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,
            next_retry_at=CASE WHEN next_status='pending' THEN clock_timestamp() ELSE NULL END,
            updated_at=clock_timestamp()
        WHERE e.outbox_id=job.outbox_id;
        INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor,error_code)
        VALUES (job.lead_id,job.outbox_id,'email_lease_recovered',job.attempts,
                job.cycle_id,job.lease_token,p_worker_id,code);
    END LOOP;
    FOR job IN
        SELECT e.* FROM trade_fair.email_outbox e
        WHERE e.status='pending' AND e.cycle_attempts<e.max_attempts
          AND COALESCE(e.next_retry_at,e.created_at)<=clock_timestamp()
        ORDER BY COALESCE(e.next_retry_at,e.created_at),e.created_at,e.outbox_id
        FOR UPDATE OF e SKIP LOCKED LIMIT p_limit
    LOOP
        stamp:=clock_timestamp();
        UPDATE trade_fair.email_outbox e SET status='leased',lease_token=gen_random_uuid(),
            lease_expires_at=stamp+make_interval(secs=>p_lease_seconds),worker_id=p_worker_id,
            max_attempts=CASE WHEN e.cycle_attempts=0 THEN p_max_attempts ELSE e.max_attempts END,
            next_retry_at=NULL,updated_at=stamp
        WHERE e.outbox_id=job.outbox_id RETURNING e.* INTO claimed;
        INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor)
        VALUES (claimed.lead_id,claimed.outbox_id,'email_claimed',claimed.attempts,
                claimed.cycle_id,claimed.lease_token,p_worker_id);
        outbox_id:=claimed.outbox_id; lead_id:=claimed.lead_id; lease_token:=claimed.lease_token;
        lease_expires_at:=claimed.lease_expires_at; attempt:=claimed.attempts+1;
        idempotency_key:=claimed.idempotency_key; sender:=claimed.sender; recipient:=claimed.recipient;
        subject:=claimed.subject; text_body:=claimed.text_body;
        RETURN NEXT;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.begin_email_send(p_outbox_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE job trade_fair.email_outbox%ROWTYPE;
BEGIN
    SELECT e.* INTO job FROM trade_fair.email_outbox e WHERE e.outbox_id=p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','should_send',false); END IF;
    IF job.status='delivered' AND job.delivery_token=p_lease_token THEN
        RETURN jsonb_build_object('ok',true,'code','DELIVERED','should_send',false);
    END IF;
    IF job.status='sending' AND job.lease_token=p_lease_token THEN
        RETURN jsonb_build_object('ok',false,'code','SEND_ALREADY_STARTED','should_send',false);
    END IF;
    IF job.status<>'leased' OR job.lease_token IS DISTINCT FROM p_lease_token
       OR job.lease_expires_at IS NULL OR job.lease_expires_at<=clock_timestamp() THEN
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE','should_send',false);
    END IF;
    UPDATE trade_fair.email_outbox e SET status='sending',attempts=e.attempts+1,
        cycle_attempts=e.cycle_attempts+1,last_error_code=NULL,updated_at=clock_timestamp()
    WHERE e.outbox_id=p_outbox_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor)
    VALUES (job.lead_id,p_outbox_id,'email_send_started',job.attempts+1,job.cycle_id,p_lease_token,job.worker_id);
    RETURN jsonb_build_object('ok',true,'code','SEND_STARTED','should_send',true,
        'outbox_id',p_outbox_id,'idempotency_key',job.idempotency_key);
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.finish_email_send(
    p_outbox_id uuid,p_lease_token uuid,p_provider_message_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE job trade_fair.email_outbox%ROWTYPE;
BEGIN
    IF p_provider_message_id IS NULL OR char_length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 512 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A bounded provider acknowledgement ID is required';
    END IF;
    SELECT e.* INTO job FROM trade_fair.email_outbox e WHERE e.outbox_id=p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.status='delivered' AND job.delivery_token=p_lease_token THEN
        IF job.provider_message_id=p_provider_message_id THEN
            RETURN jsonb_build_object('ok',true,'code','REPLAYED','email_status','delivered','idempotent_replay',true);
        END IF;
        RETURN jsonb_build_object('ok',false,'code','RESULT_CONFLICT');
    END IF;
    IF job.status<>'sending' OR job.lease_token IS DISTINCT FROM p_lease_token
       OR job.lease_expires_at IS NULL OR job.lease_expires_at<=clock_timestamp() THEN
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE');
    END IF;
    UPDATE trade_fair.email_outbox e SET status='delivered',delivery_token=p_lease_token,
        provider_message_id=p_provider_message_id,delivered_at=clock_timestamp(),last_error_code=NULL,
        lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,next_retry_at=NULL,updated_at=clock_timestamp()
    WHERE e.outbox_id=p_outbox_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor)
    VALUES (job.lead_id,p_outbox_id,'email_delivered',job.attempts,job.cycle_id,p_lease_token,job.worker_id);
    RETURN jsonb_build_object('ok',true,'code','DELIVERED','email_status','delivered','idempotent_replay',false);
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.fail_email_send(
    p_outbox_id uuid,p_lease_token uuid,p_error_code text,p_outcome text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE
    job trade_fair.email_outbox%ROWTYPE;
    next_status text; retry_at timestamptz; delay_seconds integer;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$'
       OR p_outcome IS NULL OR p_outcome NOT IN ('definite_retryable','definite_permanent','uncertain') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid bounded email failure classification';
    END IF;
    SELECT e.* INTO job FROM trade_fair.email_outbox e WHERE e.outbox_id=p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.status NOT IN ('leased','sending') OR job.lease_token IS DISTINCT FROM p_lease_token
       OR job.lease_expires_at IS NULL OR job.lease_expires_at<=clock_timestamp() THEN
        RETURN jsonb_build_object('ok',false,'code','STALE_LEASE');
    END IF;
    IF p_outcome='uncertain' THEN next_status:='uncertain';
    ELSIF p_outcome='definite_retryable' AND job.cycle_attempts<job.max_attempts THEN
        next_status:='pending';
        delay_seconds:=LEAST(3600,30*power(2,LEAST(GREATEST(job.cycle_attempts-1,0),7))::integer);
        retry_at:=clock_timestamp()+make_interval(secs=>delay_seconds);
    ELSE next_status:='failed'; END IF;
    UPDATE trade_fair.email_outbox e SET status=next_status,last_error_code=p_error_code,
        next_retry_at=retry_at,lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=clock_timestamp()
    WHERE e.outbox_id=p_outbox_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,lease_token,actor,error_code)
    VALUES (job.lead_id,p_outbox_id,'email_'||CASE WHEN next_status='pending' THEN 'retry_scheduled' ELSE next_status END,
            job.attempts,job.cycle_id,p_lease_token,job.worker_id,p_error_code);
    RETURN jsonb_build_object('ok',true,'code',CASE WHEN next_status='pending' THEN 'RETRY_SCHEDULED'
        WHEN next_status='uncertain' THEN 'UNCERTAIN' ELSE 'FAILED' END,
        'email_status',next_status,'next_retry_at',retry_at);
END;
$function$;

-- OPERATOR RECOVERY ---------------------------------------------------------
-- Do not grant these functions to an unattended worker or an anonymous form.
-- Retry cycles reset; cumulative attempts and transition history are retained.
CREATE OR REPLACE FUNCTION trade_fair.retry_failed_processing(p_lead_id text,p_operator_note text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE job trade_fair.lead_submissions%ROWTYPE; cycle uuid:=gen_random_uuid();
BEGIN
    IF p_operator_note IS NULL OR char_length(btrim(p_operator_note)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An operator recovery note is required';
    END IF;
    SELECT s.* INTO job FROM trade_fair.lead_submissions s WHERE s.lead_id=p_lead_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.processing_status<>'failed' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FAILED'); END IF;
    IF EXISTS (SELECT 1 FROM trade_fair.processing_results r WHERE r.lead_id=p_lead_id) THEN
        RETURN jsonb_build_object('ok',false,'code','ALREADY_COMPLETED');
    END IF;
    UPDATE trade_fair.lead_submissions s SET processing_status='pending',processing_cycle_id=cycle,
        processing_cycle_attempts=0,processing_next_retry_at=clock_timestamp(),last_error_code=NULL,
        processing_lease_token=NULL,processing_lease_expires_at=NULL,processing_worker_id=NULL,
        processing_started_at=NULL,processing_updated_at=clock_timestamp()
    WHERE s.lead_id=p_lead_id;
    INSERT INTO trade_fair.job_events (lead_id,event_kind,attempt,cycle_id,actor,operator_note)
    VALUES (p_lead_id,'processing_operator_retry',job.processing_attempts,cycle,session_user,p_operator_note);
    RETURN jsonb_build_object('ok',true,'code','REQUEUED','processing_status','pending',
        'processing_attempts',job.processing_attempts);
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.resolve_email_uncertain(
    p_outbox_id uuid,p_action text,p_operator_note text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE job trade_fair.email_outbox%ROWTYPE; cycle uuid; next_status text;
BEGIN
    IF p_action IS NULL OR p_action NOT IN ('confirmed_delivered','confirmed_not_delivered')
       OR p_operator_note IS NULL OR char_length(btrim(p_operator_note)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Use a verified delivery outcome and an operator note';
    END IF;
    SELECT e.* INTO job FROM trade_fair.email_outbox e WHERE e.outbox_id=p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.status<>'uncertain' THEN RETURN jsonb_build_object('ok',false,'code','NOT_UNCERTAIN'); END IF;
    cycle:=CASE WHEN p_action='confirmed_not_delivered' THEN gen_random_uuid() ELSE job.cycle_id END;
    next_status:=CASE WHEN p_action='confirmed_delivered' THEN 'delivered' ELSE 'pending' END;
    UPDATE trade_fair.email_outbox e SET status=next_status,cycle_id=cycle,
        cycle_attempts=CASE WHEN next_status='pending' THEN 0 ELSE e.cycle_attempts END,
        next_retry_at=CASE WHEN next_status='pending' THEN clock_timestamp() ELSE NULL END,
        delivered_at=CASE WHEN next_status='delivered' THEN clock_timestamp() ELSE NULL END,
        last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,updated_at=clock_timestamp()
    WHERE e.outbox_id=p_outbox_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,actor,operator_note)
    VALUES (job.lead_id,p_outbox_id,'email_operator_'||p_action,job.attempts,cycle,session_user,p_operator_note);
    RETURN jsonb_build_object('ok',true,'code',CASE WHEN next_status='delivered' THEN 'DELIVERED' ELSE 'REQUEUED' END,
        'email_status',next_status);
END;
$function$;

CREATE OR REPLACE FUNCTION trade_fair.retry_failed_email(p_outbox_id uuid,p_operator_note text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
DECLARE job trade_fair.email_outbox%ROWTYPE; cycle uuid:=gen_random_uuid();
BEGIN
    IF p_operator_note IS NULL OR char_length(btrim(p_operator_note)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An operator recovery note is required';
    END IF;
    SELECT e.* INTO job FROM trade_fair.email_outbox e WHERE e.outbox_id=p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF job.status<>'failed' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FAILED'); END IF;
    UPDATE trade_fair.email_outbox e SET status='pending',cycle_id=cycle,cycle_attempts=0,
        next_retry_at=clock_timestamp(),last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL,
        worker_id=NULL,updated_at=clock_timestamp()
    WHERE e.outbox_id=p_outbox_id;
    INSERT INTO trade_fair.job_events (lead_id,outbox_id,event_kind,attempt,cycle_id,actor,operator_note)
    VALUES (job.lead_id,p_outbox_id,'email_operator_retry',job.attempts,cycle,session_user,p_operator_note);
    RETURN jsonb_build_object('ok',true,'code','REQUEUED','email_status','pending','email_attempts',job.attempts);
END;
$function$;

-- FRONTEND STATUS -----------------------------------------------------------
-- The gateway must authenticate the user. The original submission UUID is an
-- additional capability check; neither a sequential ID nor a public list API
-- is provided. This function returns no contact information or provider data.
CREATE OR REPLACE FUNCTION trade_fair.get_lead_status(p_lead_id text,p_submission_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
    SELECT COALESCE((
        SELECT jsonb_build_object(
            'success',true,'lead_id',s.lead_id,
            'processing_status',s.processing_status,'processing_attempts',s.processing_attempts,
            'next_retry_at',s.processing_next_retry_at,'last_error_code',s.last_error_code,
            'review_required',(s.review_required
                OR COALESCE(r.result_payload#>>'{extraction,needs_human_review}','false')='true'
                OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                    COALESCE(r.result_payload->'uncertainty_flags','[]'::jsonb)) f(flag)
                    WHERE strpos(f.flag,'structured_ai_conflict')=1)),
            'score_band',r.score_band,'score_total',r.score_total,
            'email_status',e.status,'email_next_retry_at',e.next_retry_at,
            'updated_at',GREATEST(s.processing_updated_at,s.persisted_at,r.created_at,e.updated_at)
        ) FROM trade_fair.lead_submissions s
        LEFT JOIN trade_fair.processing_results r ON r.lead_id=s.lead_id
        LEFT JOIN trade_fair.email_outbox e ON e.lead_id=s.lead_id
        WHERE s.lead_id=p_lead_id AND s.submission_id=p_submission_id
    ),jsonb_build_object('success',false,'error',jsonb_build_object('code','NOT_FOUND','message','Lead not found.')));
$function$;

-- OPERATOR MONITORING -------------------------------------------------------
-- Bounded recovery metadata, never contact information or provider payloads.
-- Counts include every state so an empty queue is distinguishable from an
-- unavailable monitor. The operator still needs explicit evidence before
-- resolving an uncertain delivery.
CREATE OR REPLACE FUNCTION trade_fair.queue_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,trade_fair,pg_temp
AS $function$
    SELECT jsonb_build_object(
        'checked_at',statement_timestamp(),
        'processing_counts',(
            SELECT jsonb_build_object(
                'pending',count(*) FILTER (WHERE s.processing_status='pending'),
                'processing',count(*) FILTER (WHERE s.processing_status='processing'),
                'completed',count(*) FILTER (WHERE s.processing_status='completed'),
                'failed',count(*) FILTER (WHERE s.processing_status='failed')
            ) FROM trade_fair.lead_submissions s
        ),
        'email_counts',(
            SELECT jsonb_build_object(
                'pending',count(*) FILTER (WHERE e.status='pending'),
                'leased',count(*) FILTER (WHERE e.status='leased'),
                'sending',count(*) FILTER (WHERE e.status='sending'),
                'delivered',count(*) FILTER (WHERE e.status='delivered'),
                'uncertain',count(*) FILTER (WHERE e.status='uncertain'),
                'failed',count(*) FILTER (WHERE e.status='failed')
            ) FROM trade_fair.email_outbox e
        ),
        'processing_failures',COALESCE((
            SELECT jsonb_agg(to_jsonb(f) ORDER BY f.updated_at DESC,f.lead_id)
            FROM (
                SELECT s.lead_id,s.processing_status,s.processing_attempts,
                       s.last_error_code,s.processing_updated_at AS updated_at
                FROM trade_fair.lead_submissions s
                WHERE s.processing_status='failed'
                ORDER BY s.processing_updated_at DESC,s.lead_id LIMIT 50
            ) f
        ),'[]'::jsonb),
        'email_attention',COALESCE((
            SELECT jsonb_agg(to_jsonb(f) ORDER BY f.updated_at DESC,f.outbox_id)
            FROM (
                SELECT e.outbox_id,e.lead_id,e.status AS email_status,e.attempts,
                       e.last_error_code,e.updated_at
                FROM trade_fair.email_outbox e
                WHERE e.status IN ('uncertain','failed')
                ORDER BY e.updated_at DESC,e.outbox_id LIMIT 50
            ) f
        ),'[]'::jsonb)
    );
$function$;

REVOKE CREATE ON SCHEMA trade_fair FROM PUBLIC;
REVOKE ALL ON trade_fair.schema_migrations,trade_fair.processing_results,trade_fair.email_outbox,trade_fair.job_events FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.claim_processing(text,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.renew_processing(text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.finish_processing(text,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.fail_processing(text,uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.claim_email(text,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.begin_email_send(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.finish_email_send(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.fail_email_send(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.retry_failed_processing(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.resolve_email_uncertain(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.retry_failed_email(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.get_lead_status(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION trade_fair.queue_health() FROM PUBLIC;

INSERT INTO trade_fair.schema_migrations (version,description)
VALUES ('002_processing','Fenced processing leases, immutable results, durable sales-email outbox and operator recovery')
ON CONFLICT (version) DO NOTHING;

COMMENT ON COLUMN trade_fair.email_outbox.status IS
'delivered means provider acceptance was acknowledged (or independently confirmed by an operator), not proof of inbox delivery or reading. uncertain must never be automatically resent.';
COMMENT ON COLUMN trade_fair.email_outbox.idempotency_key IS
'Stable across every retry. Pass to a provider that supports idempotency; a stable Message-ID alone is not a universal SMTP deduplication guarantee.';
COMMENT ON TABLE trade_fair.processing_results IS
'One immutable processing result and sales-notification snapshot per lead. Worker roles receive EXECUTE-only function access and no direct table privileges.';
COMMENT ON FUNCTION trade_fair.get_lead_status(text,text) IS
'Minimal non-PII status for an authenticated gateway, guarded by both lead ID and original submission ID.';

COMMIT;

-- Apply ops/grant_processing_roles.sql as the trusted migration owner with
-- separate, already-provisioned worker_role, status_role and operator_role.
-- Worker: EXECUTE only on claim/renew/finish/fail processing and email functions.
-- Status gateway: EXECUTE only on get_lead_status.
-- Operator: EXECUTE only on retry_failed_processing, resolve_email_uncertain
-- retry_failed_email and queue_health. Require authenticated, explicit actions.
-- These roles receive schema USAGE but no table DML or schema CREATE.
-- Migration owner owns the fixed, schema-qualified SECURITY DEFINER functions.
-- The original WF-A capture role and SECURITY INVOKER function are unchanged.
-- Sender, recipient, subject and text_body are frozen together in the outbox;
-- later server-configuration changes cannot change a retried provider payload.
-- No automatic deletion/retention policy is installed; choose it deliberately.
