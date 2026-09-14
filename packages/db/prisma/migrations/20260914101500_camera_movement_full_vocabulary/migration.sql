-- Hand-written, not scaffolded by `prisma migrate dev`. Prisma diffs a renamed
-- enum value as "drop PAN_UP, add TILT_UP", which would fail against any row
-- still holding the old value (and would need a full type recreate). Postgres
-- can rename an enum label in place instead, which is both non-destructive and
-- instant.

-- 1. Fix two mislabeled values. A pan is horizontal rotation; vertical rotation
--    is a tilt, so PAN_UP/PAN_DOWN were always tilts. RENAME VALUE implicitly
--    updates every existing shots.cameraMovement row, because in Postgres the
--    enum label IS the stored value — there is no separate data migration to do
--    for the column. PAN_LEFT/PAN_RIGHT are correctly named and stay untouched.
ALTER TYPE "CameraMovement" RENAME VALUE 'PAN_UP' TO 'TILT_UP';
ALTER TYPE "CameraMovement" RENAME VALUE 'PAN_DOWN' TO 'TILT_DOWN';

-- 2. The rest of the cinematography vocabulary. Purely additive.
ALTER TYPE "CameraMovement" ADD VALUE 'CRASH_ZOOM';
ALTER TYPE "CameraMovement" ADD VALUE 'DOLLY_ZOOM';
ALTER TYPE "CameraMovement" ADD VALUE 'WHIP_PAN';
ALTER TYPE "CameraMovement" ADD VALUE 'ROLL';
ALTER TYPE "CameraMovement" ADD VALUE 'PEDESTAL_UP';
ALTER TYPE "CameraMovement" ADD VALUE 'PEDESTAL_DOWN';
ALTER TYPE "CameraMovement" ADD VALUE 'ARC_LEFT';
ALTER TYPE "CameraMovement" ADD VALUE 'ARC_RIGHT';
ALTER TYPE "CameraMovement" ADD VALUE 'STEADICAM_FOLLOW';
ALTER TYPE "CameraMovement" ADD VALUE 'AERIAL';

-- 3. ai_model_options.config -> 'preferredCameraMovements' stores movements as
--    plain JSON strings (see VideoModelConfig in lib/video-model-config.ts), so
--    the enum rename above does NOT reach them — a routing rule configured
--    before this migration would keep saying "PAN_UP", silently stop matching
--    any shot, and get dropped on the next read by parseVideoModelConfig's
--    allow-list filter. Rewrite them in place, preserving array order.
--
--    Deliberately written to touch only rows that actually contain the old
--    values, and guarded on the JSON actually being an object with an array at
--    that key, so a malformed or absent config is left alone rather than erroring.
UPDATE "ai_model_options" AS a
SET config = jsonb_set(
      a.config,
      '{preferredCameraMovements}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN elem = '"PAN_UP"'::jsonb   THEN '"TILT_UP"'::jsonb
                   WHEN elem = '"PAN_DOWN"'::jsonb THEN '"TILT_DOWN"'::jsonb
                   ELSE elem
                 END
                 ORDER BY ord
               )
        FROM jsonb_array_elements(a.config -> 'preferredCameraMovements')
             WITH ORDINALITY AS t(elem, ord)
      )
    )
WHERE jsonb_typeof(a.config) = 'object'
  AND jsonb_typeof(a.config -> 'preferredCameraMovements') = 'array'
  AND (
        a.config -> 'preferredCameraMovements' @> '["PAN_UP"]'::jsonb
     OR a.config -> 'preferredCameraMovements' @> '["PAN_DOWN"]'::jsonb
  );
