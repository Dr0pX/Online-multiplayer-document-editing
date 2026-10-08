CREATE TABLE IF NOT EXISTS document_collab_states (
  document_id VARCHAR(64) NOT NULL PRIMARY KEY,
  yjs_state LONGBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_collab_states_document
    FOREIGN KEY (document_id) REFERENCES documents(id)
    ON DELETE CASCADE
);
