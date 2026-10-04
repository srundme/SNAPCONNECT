ALTER TABLE "Workspace" ADD COLUMN "leadQuestions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Lead" ADD COLUMN "answers" JSONB NOT NULL DEFAULT '{}';

UPDATE "Workspace"
SET "leadQuestions" = '[{"id":"person-name","label":"Person name","kind":"name"},{"id":"company-name","label":"Company name","kind":"text"},{"id":"contact-number","label":"Contact number","kind":"phone"},{"id":"team-size","label":"Current telecaller team size","kind":"text"},{"id":"issue","label":"What is the issue, or why do you think AI calling may help?","kind":"text"},{"id":"call-volume","label":"Monthly call volume","kind":"text"},{"id":"demo","label":"Are you interested to attend the demo?","kind":"yesno"}]'::jsonb
WHERE "brandName" = 'SnapServe';
