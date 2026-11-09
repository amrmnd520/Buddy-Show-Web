-- Нөөцлөлтийн функц — Supabase SQL Editor дээр нэг удаа ажиллуулна.
--
-- Яагаад хэрэгтэй вэ: PostgREST нэг хүсэлтэд 1000 мөр буцаадаг (max-rows). Бидний өгөгдөл
-- 60 мянга гаруй мөр тул хуудаславал 60+ хүсэлт болох ба Cloudflare Worker нэг ажиллагаанд
-- ~50 хүсэлт л хийж чадна. Тэгэхээр нөөцлөлт дунд замдаа тасардаг.
--
-- Энэ функц хүснэгтийг бүтнээр нь НЭГ мөр текст болгож буцаана — PostgREST-ийн хувьд үр дүн
-- нь ганц мөр тул 1000-ын хязгаар хамаарахгүй. Ингэснээр хүснэгт бүрт яг нэг хүсэлт:
-- нийт 18 хүсэлт, өгөгдөл хэр өссөн ч өөрчлөгдөхгүй.
--
-- Аюулгүй байдал: зөвхөн доорх жагсаалтад байгаа хүснэгтийг зөвшөөрнө (нэрийг шууд SQL руу
-- залгахгүй), мөн service_role-оос өөр хэнд ч EXECUTE эрх өгөхгүй. Үүнд барааны өртөг,
-- харилцагчийн мэдээлэл бүгд багтдаг тул anon болон нэвтэрсэн хэрэглэгч дуудаж болохгүй.

create or replace function public.backup_dump(tbl text)
returns text
language plpgsql
security invoker
as $$
declare
  body text;
begin
  if tbl not in (
    'ops','settings','vendors','products','customers',
    'sales','sale_lines','sale_payments','returns','return_lines',
    'receipts','receipt_lines','stocktakes','stocktake_lines',
    'shifts','cash_moves','audit_log','staff'
  ) then
    raise exception 'backup_dump: зөвшөөрөгдөөгүй хүснэгт %', tbl;
  end if;

  -- Мөр бүр нэг JSON — NDJSON. Хоосон хүснэгт хоосон мөр буцаана.
  execute format('select coalesce(string_agg(to_jsonb(t)::text, E''\n''), '''') from %I t', tbl)
    into body;

  return body;
end;
$$;

-- Зөвхөн Worker (service_role) дуудна. Бусдаас эрхийг нь булаана.
revoke all on function public.backup_dump(text) from public;
revoke all on function public.backup_dump(text) from anon;
revoke all on function public.backup_dump(text) from authenticated;
grant execute on function public.backup_dump(text) to service_role;
