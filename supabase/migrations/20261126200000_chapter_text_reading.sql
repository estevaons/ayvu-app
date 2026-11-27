-- O player mostra o texto do capítulo aparecendo junto com a narração.
-- `timings`: um array por parágrafo de segmentos [início_s, fim_s, texto_falado],
-- gravado pelo worker de TTS. Capítulos antigos ficam com null e o app estima o tempo.
alter table public.chapter_texts add column timings jsonb;

-- O dono do capítulo pode ler o texto (escrita continua só com a service role).
create policy "Users read their chapter texts" on public.chapter_texts
  for select to authenticated
  using (exists (
    select 1 from public.chapters c
    where c.id = chapter_id and c.user_id = (select auth.uid())
  ));
