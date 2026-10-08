CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  excerpt VARCHAR(255) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  content LONGTEXT NOT NULL,
  collaborators_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO documents (id, title, excerpt, owner_name, content, collaborators_json, updated_at)
VALUES
  (
    'brief-q2',
    'Q2 product review notes',
    'A working sample document for wiring the frontend to the MySQL-backed API.',
    'Lin Qing',
    '<h1>Q2 product review notes</h1><p>This document came from the Express API and MySQL.</p>',
    JSON_ARRAY(
      JSON_OBJECT('id', 'u1', 'name', 'Lin Qing', 'color', '#b45309', 'status', 'editing', 'focusLabel', 'Updating summary'),
      JSON_OBJECT('id', 'u2', 'name', 'Zhao Ce', 'color', '#0f766e', 'status', 'viewing', 'focusLabel', 'Reading notes')
    ),
    CURRENT_TIMESTAMP
  ),
  (
    'prd-editor',
    'Collaborative editor MVP',
    'Scope, editing capabilities, and backend API goals for the first release.',
    'Chen Yang',
    '<h1>Collaborative editor MVP</h1><p>This is another seeded document stored in MySQL.</p>',
    JSON_ARRAY(
      JSON_OBJECT('id', 'u3', 'name', 'Chen Yang', 'color', '#be123c', 'status', 'editing', 'focusLabel', 'Defining MVP')
    ),
    CURRENT_TIMESTAMP
  )
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  excerpt = VALUES(excerpt),
  owner_name = VALUES(owner_name),
  content = VALUES(content),
  collaborators_json = VALUES(collaborators_json),
  updated_at = CURRENT_TIMESTAMP;
