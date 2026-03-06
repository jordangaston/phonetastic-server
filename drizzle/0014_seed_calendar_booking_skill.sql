INSERT INTO "skills" ("name", "settings_schema", "params_schema")
VALUES ('calendar_booking', '{}', '{}')
ON CONFLICT DO NOTHING;
