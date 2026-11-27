import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  title: "Política de Privacidade — Ayvu",
};

// Página pública (fora do AppShell): o Google exige o link na tela de consentimento do OAuth.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pt-safe pb-safe">
      <div className="py-10">
        <Link href="/login/">
          <Logo />
        </Link>
        <h1 className="mt-10 font-serif text-4xl tracking-tight">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-faint">Atualizada em 26 de novembro de 2026</p>

        <div className="mt-8 flex flex-col gap-6 leading-relaxed text-muted [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-ink">
          <p>
            O Ayvu transforma PDFs e ebooks que você envia em audiolivros. Esta página explica quais dados usamos
            para isso e como cuidamos deles.
          </p>

          <h2>O que coletamos</h2>
          <ul className="list-disc pl-5">
            <li>
              <strong className="text-ink">Conta:</strong> seu e-mail e nome. Se você entra com o Google, recebemos
              apenas nome, e-mail e foto de perfil — nada do seu Gmail, Drive ou outros serviços.
            </li>
            <li>
              <strong className="text-ink">Seus livros:</strong> os arquivos que você envia, o texto extraído deles e
              o áudio gerado.
            </li>
            <li>
              <strong className="text-ink">Progresso e preferências:</strong> onde você parou em cada livro, voz,
              velocidade, tema e idioma.
            </li>
          </ul>

          <h2>Como usamos</h2>
          <p>
            Só para fazer o app funcionar: entrar na sua conta, gerar a narração dos seus livros e sincronizar seu
            progresso entre aparelhos. Não vendemos seus dados, não mostramos anúncios e não usamos seus livros para
            treinar modelos.
          </p>

          <h2>Onde ficam</h2>
          <p>
            Conta, arquivos e áudios ficam no Supabase, com acesso restrito à sua conta. A narração é gerada em
            servidores da Modal com um modelo de voz executado por nós; o texto não é enviado a serviços de terceiros
            de voz. Livros baixados para ouvir offline ficam só no seu aparelho.
          </p>

          <h2>Seus direitos</h2>
          <p>
            Você pode excluir qualquer livro a qualquer momento, e com ele o arquivo e o áudio. Para apagar sua conta
            e todos os dados, ou tirar dúvidas sobre esta política, fale com a gente pelo e-mail de suporte do app.
          </p>
        </div>
      </div>
    </main>
  );
}
