CREATE TABLE metadata(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE entities(
  kind TEXT NOT NULL CHECK(kind IN ('projects','sessions','nodes','edges','groups','jobs','assets','users')),
  id TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(kind,id)
) STRICT;
INSERT INTO metadata(key,value) VALUES('revision','0');
