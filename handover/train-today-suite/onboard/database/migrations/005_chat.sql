SET LOCAL search_path TO employee_onboarding;
CREATE TABLE chat_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('direct','group')),
 title text NOT NULL DEFAULT '',
 direct_key text UNIQUE,
 created_by uuid NOT NULL REFERENCES user_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='direct' AND direct_key IS NOT NULL) OR (kind='group' AND direct_key IS NULL AND length(title)>0))
);
CREATE TABLE chat_members (
 conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES user_accounts(id),
 last_read_id bigint NOT NULL DEFAULT 0,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX chat_members_user ON chat_members(user_id,conversation_id);
CREATE TABLE chat_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL REFERENCES user_accounts(id),
 client_id uuid NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX chat_messages_conversation ON chat_messages(conversation_id,id DESC);
