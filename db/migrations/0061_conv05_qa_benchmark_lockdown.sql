-- Keep the private benchmark schema inaccessible to application/API roles.
REVOKE ALL ON SCHEMA qa_conv05 FROM PUBLIC, anon, authenticated, service_role, kallistis;
REVOKE ALL ON ALL TABLES IN SCHEMA qa_conv05 FROM PUBLIC, anon, authenticated, service_role, kallistis;
ALTER DEFAULT PRIVILEGES IN SCHEMA qa_conv05
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, kallistis;

ALTER TABLE qa_conv05.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_conv05.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_conv05.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_conv05.sediment_candidates ENABLE ROW LEVEL SECURITY;
