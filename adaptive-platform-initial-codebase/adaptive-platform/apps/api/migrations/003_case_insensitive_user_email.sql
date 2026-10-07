DO $$
BEGIN
  IF EXISTS (
    SELECT lower(email)
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce case-insensitive user email uniqueness: duplicate emails differ only by case';
  END IF;
END;
$$;

CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (lower(email));
