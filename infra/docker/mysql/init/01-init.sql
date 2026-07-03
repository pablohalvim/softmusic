-- SoftMusic MySQL initialization
-- Executado automaticamente na primeira inicialização do container

CREATE DATABASE IF NOT EXISTS softmusic
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON softmusic.* TO 'softmusic'@'%';
FLUSH PRIVILEGES;
