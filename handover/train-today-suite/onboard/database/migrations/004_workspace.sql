SET LOCAL search_path TO employee_onboarding;
CREATE TABLE workspace_permissions (
 user_id uuid PRIMARY KEY REFERENCES user_accounts(id),
 system_admin boolean NOT NULL DEFAULT false
);
-- Explicit local assignment to the existing system administrator; not all IT staff.
INSERT INTO workspace_permissions(user_id,system_admin)
SELECT u.id,true FROM user_accounts u JOIN employees e ON e.id=u.employee_id
WHERE u.username='jonas' AND e.role='Systemadministrator' ON CONFLICT DO NOTHING;
CREATE TABLE company_rules (
 id text PRIMARY KEY, title text NOT NULL, body text NOT NULL, position integer NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company_rules(id,title,body,position) VALUES
('collaboration','Zusammenarbeit und Verantwortung','Wir arbeiten respektvoll, verlässlich und lösungsorientiert. Aufgaben haben eine zuständige Person und einen vereinbarten Termin. Wer eine Frist nicht einhalten kann, informiert frühzeitig die Beteiligten und stimmt den nächsten Schritt ab. Entscheidungen und Übergaben dokumentieren wir im gemeinsamen Arbeitsbereich.',1),
('communication','Kommunikation und Erreichbarkeit','Der Mitarbeiter-Workspace ist die erste Anlaufstelle für Aufgaben, Zugänge und interne Informationen. Halte deinen Aufgabenstatus aktuell und fasse wichtige Absprachen schriftlich zusammen. Abwesenheiten und Vertretungen werden mit der Führungskraft abgestimmt; persönliche Angelegenheiten besprichst du vertraulich mit HR.',2),
('security','Konten und Informationssicherheit','Nutze ausschließlich persönlich freigegebene Konten. Passwörter werden nicht geteilt und gehören nicht in Aufgabenkommentare, E-Mails oder öffentliche Dokumente. Aktiviere Mehrfaktor-Anmeldung, sofern das System sie anbietet. Sperre deinen Bildschirm beim Verlassen des Arbeitsplatzes. Verdächtige Anmeldungen oder Nachrichten meldest du unmittelbar an die IT.',3),
('confidentiality','Vertrauliche Informationen','Kunden-, Vertrags- und Personaldaten werden nur für die jeweilige Aufgabe verwendet und nur mit berechtigten Kollegen geteilt. Personalunterlagen bleiben im HR-Bereich. Vertrauliche Informationen dürfen nicht ohne Freigabe in externe KI-Dienste, private Clouds oder private E-Mail-Konten übertragen werden.',4),
('documents','Dokumente und Qualität','Speichere Arbeitsunterlagen im freigegebenen Bereich und verwende klare Dateinamen. Kennzeichne Entwürfe und halte freigegebene Versionen nachvollziehbar. Prüfe Inhalte, Zahlen und Empfänger vor einer Veröffentlichung. KI-generierte Texte benötigen eine fachliche Prüfung durch die verantwortliche Person.',5),
('workplace','Arbeitsplatz und Ausstattung','Behandle Geräte und Arbeitsmittel sorgfältig. Melde technische Probleme an die IT und Sicherheitsmängel an deine Führungskraft. Installationen, zusätzliche Lizenzen und neue Systemrechte werden über den zuständigen Verantwortlichen beantragt. Eigenständige Beschaffung oder Freischaltung ersetzt keine Genehmigung.',6),
('customer','Kundenkontakt und Außenauftritt','Wir machen nachvollziehbare Zusagen und kommunizieren Änderungen rechtzeitig. Angebote, Preise und verbindliche Termine werden durch die zuständige Stelle freigegeben. In Präsentationen und Veröffentlichungen verwenden wir die freigegebenen Markenunterlagen. Beschwerden dokumentieren wir sachlich und geben sie an den zuständigen Ansprechpartner weiter.',7),
('onboarding','Dein Einstieg bei Train Today','Prüfe deine persönlichen Angaben, teste die freigegebenen Zugänge und bearbeite die zugewiesenen Aufgaben. Wenn ein Zugang fehlt oder ein Schritt unklar ist, melde dies im Aufgabenbereich. Eine Rückmeldung „abgeschlossen“ wird bei bestätigungspflichtigen Schritten von HR oder IT geprüft. Einführungsgespräche und Check-ins finden persönlich mit der zuständigen Führungskraft statt.',8);
CREATE TABLE rule_acknowledgements (
 user_id uuid REFERENCES user_accounts(id), rule_id text REFERENCES company_rules(id),
 version integer NOT NULL, acknowledged_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,rule_id,version)
);
CREATE TABLE employee_accesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
 system_name text NOT NULL, username text NOT NULL DEFAULT '', login_url text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','in_progress','active','blocked','disabled')),
 evidence text NOT NULL DEFAULT '', updated_by uuid REFERENCES user_accounts(id),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id,system_name)
);
INSERT INTO employee_accesses(employee_id,system_name,login_url)
SELECT e.id,a.name,CASE a.name WHEN 'CRM' THEN 'http://localhost:3080/' WHEN 'Google Workspace' THEN 'https://accounts.google.com/' WHEN 'GitHub' THEN 'https://github.com/login' ELSE '' END
FROM employees e JOIN departments d ON d.name=e.department
CROSS JOIN LATERAL jsonb_array_elements_text(d.necessary_accounts) a(name)
WHERE a.name NOT IN ('Slack','Notion','HR-Portal','Mitarbeiterportal') ON CONFLICT DO NOTHING;
CREATE TABLE access_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, access_id uuid REFERENCES employee_accesses(id),
 actor uuid NOT NULL REFERENCES user_accounts(id), status text NOT NULL, evidence text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
