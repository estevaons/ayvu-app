-- O app apaga o arquivo enviado quando a criação do livro falha depois do upload,
-- para não deixar arquivos sem livro ocupando espaço no Storage.
create policy "Users delete their uploads" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
