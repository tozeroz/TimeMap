-- Fail closed on ambiguous legacy direct conversations; never discard history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM message_threads t LEFT JOIN thread_members m ON m.thread_id=t.id
             WHERE t.kind='direct' GROUP BY t.id HAVING count(m.user_id)<>2) THEN
    RAISE EXCEPTION 'direct_messages: legacy direct thread must have exactly two members; audit required';
  END IF;
END $$;
CREATE TABLE direct_thread_pairs (
  thread_id uuid PRIMARY KEY REFERENCES message_threads(id) ON DELETE CASCADE,
  user_low uuid NOT NULL REFERENCES users(id),
  user_high uuid NOT NULL REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_low,user_high), CHECK(user_low<user_high)
);
INSERT INTO direct_thread_pairs(thread_id,user_low,user_high)
SELECT t.id,(array_agg(m.user_id ORDER BY m.user_id))[1],(array_agg(m.user_id ORDER BY m.user_id))[2]
FROM message_threads t JOIN thread_members m ON m.thread_id=t.id WHERE t.kind='direct' GROUP BY t.id;

ALTER TABLE message_threads ADD COLUMN next_message_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN thread_seq bigint;
ALTER TABLE messages ADD COLUMN client_request_id uuid;
ALTER TABLE messages ADD COLUMN request_fingerprint text;
WITH numbered AS (SELECT id,row_number() OVER(PARTITION BY thread_id ORDER BY created_at,id) AS seq FROM messages)
UPDATE messages m SET thread_seq=n.seq FROM numbered n WHERE n.id=m.id;
UPDATE message_threads t SET next_message_seq=coalesce((SELECT max(thread_seq) FROM messages m WHERE m.thread_id=t.id),0);
ALTER TABLE messages ALTER COLUMN thread_seq SET NOT NULL;
ALTER TABLE messages ADD CONSTRAINT message_seq_positive CHECK(thread_seq>0);
CREATE UNIQUE INDEX messages_thread_seq_idx ON messages(thread_id,thread_seq);
CREATE UNIQUE INDEX messages_sender_request_idx ON messages(sender_id,client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX messages_sender_recent_idx ON messages(sender_id,created_at DESC);
ALTER TABLE thread_members ADD COLUMN last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq>=0);
-- Preserve previous explicit inbox read positions during the transition.
UPDATE thread_members me SET last_read_seq=coalesce((
 SELECT max(m.thread_seq) FROM messages m JOIN inbox_reads r ON r.user_id=me.user_id AND r.scope='thread:'||me.thread_id
 WHERE m.thread_id=me.thread_id AND m.created_at<=r.read_at),0);

CREATE FUNCTION allocate_message_seq() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE message_threads SET next_message_seq=next_message_seq+1 WHERE id=NEW.thread_id RETURNING next_message_seq INTO NEW.thread_seq;
 RETURN NEW;
END $$;
CREATE TRIGGER allocate_message_seq BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION allocate_message_seq();

CREATE TABLE user_blocks (
 blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id)
);
CREATE FUNCTION enforce_direct_members() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; pair direct_thread_pairs%ROWTYPE;
BEGIN
 tid=coalesce(NEW.thread_id,OLD.thread_id);
 SELECT * INTO pair FROM direct_thread_pairs WHERE thread_id=tid;
 IF FOUND AND ((SELECT kind FROM message_threads WHERE id=tid)<>'direct' OR
    (SELECT count(*) FROM thread_members WHERE thread_id=tid)<>2 OR
    EXISTS(SELECT 1 FROM thread_members WHERE thread_id=tid AND user_id NOT IN(pair.user_low,pair.user_high))) THEN
   RAISE EXCEPTION 'direct_messages: pair and members must agree';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER direct_member_guard AFTER INSERT OR UPDATE OR DELETE ON thread_members
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_direct_members();
CREATE CONSTRAINT TRIGGER direct_pair_guard AFTER INSERT OR UPDATE ON direct_thread_pairs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_direct_members();
