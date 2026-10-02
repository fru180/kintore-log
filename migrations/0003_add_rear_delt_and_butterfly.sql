-- Make room immediately after the rotary torso while preserving the order of
-- every exercise that currently follows it.
UPDATE exercises
SET sort_order = sort_order + 2
WHERE sort_order > (
  SELECT sort_order
  FROM exercises
  WHERE name = 'ロータリートルソー'
)
AND name NOT IN ('リアデルト', 'バタフライ');

INSERT INTO exercises (name, kind, sort_order)
VALUES (
  'リアデルト',
  'strength',
  (SELECT sort_order + 1 FROM exercises WHERE name = 'ロータリートルソー')
)
ON CONFLICT(name) DO UPDATE SET
  kind = excluded.kind,
  sort_order = excluded.sort_order;

INSERT INTO exercises (name, kind, sort_order)
VALUES (
  'バタフライ',
  'strength',
  (SELECT sort_order + 2 FROM exercises WHERE name = 'ロータリートルソー')
)
ON CONFLICT(name) DO UPDATE SET
  kind = excluded.kind,
  sort_order = excluded.sort_order;
