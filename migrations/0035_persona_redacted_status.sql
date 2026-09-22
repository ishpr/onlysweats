-- Persona retains an inquiry's prior status after redaction. Store the erasure
-- separately so a later approval snapshot cannot restore its verification badge.
alter table verifications drop constraint verifications_status_check;
alter table verifications add constraint verifications_status_check check (status in (
  'created', 'pending', 'needs_review', 'approved', 'declined', 'failed', 'expired', 'redacted'
));
