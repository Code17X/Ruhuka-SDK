-- READ-ONLY DATA REVIEW: 005_data_review.sql
-- PURPOSE: Audit existing memberships and roles before enforcing strict active-state rules.
-- INSTRUCTIONS: Run these queries manually against the database. 
-- DO NOT apply any automatic migrations that alter these states without reviewing the output.
-- If any rows are returned, product approval is required before proceeding with state-enforcement migrations.

-- 1. Count memberships by status to get a high-level overview
SELECT status, COUNT(*) as count
FROM memberships
GROUP BY status
ORDER BY count DESC;

-- 2. List all pending or ended memberships with their user and organization
SELECT m.id, m.user_id, m.organization_id, m.status, m.created_at
FROM memberships m
WHERE m.status IN ('pending', 'ended')
ORDER BY m.created_at DESC;

-- 3. Check for any 'visitor' roles assigned in membership_roles
-- (Per authorization-decisions.md, 'visitor' is a non-member state and should not have active role grants)
SELECT mr.membership_id, mr.role, m.status, m.organization_id
FROM membership_roles mr
JOIN memberships m ON m.id = mr.membership_id
WHERE mr.role = 'visitor' OR m.status IN ('pending', 'ended');