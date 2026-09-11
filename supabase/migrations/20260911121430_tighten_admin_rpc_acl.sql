revoke execute on function public.claim_first_compute_admin() from anon;
revoke execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) from anon;
revoke execute on function public.is_compute_admin() from anon;
