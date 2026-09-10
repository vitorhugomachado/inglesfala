# Inglês Fala — tutor por voz

App público: https://tutor-api-production-088a.up.railway.app

Ligue o microfone uma vez, permita o acesso e converse com Alex. O tutor conduz perguntas e exercícios; a fala é enviada automaticamente após uma pausa. Use Encerrar conversa para desligar o microfone. Ao trocar de aba a sessão também é encerrada.

## Publicação

Frontend React/Vite e API Fastify são servidos no mesmo domínio HTTPS da Railway. O Dockerfile compila os dois projetos; somente arquivos públicos compilados do frontend são servidos. A Railway acompanha a branch main de https://github.com/vitorhugomachado/inglesfala.

Projeto Railway: voice-english-tutor (9f662fb7-8199-46c4-8a7b-8535e3c083e1).
Serviço: tutor-api (53a08f67-23c2-4aec-8b2c-25054561e4c3).
Healthcheck: /health.

## Configuração

No servidor: GROQ_API_KEY, BACKEND_ACCESS_TOKEN, NODE_ENV=production, HOST=0.0.0.0 e PORT definido pela Railway. PUBLIC_APP_ORIGIN define a origem HTTPS permitida para ações do navegador; se omitido usa https:// seguido de RAILWAY_PUBLIC_DOMAIN.

As chaves ficam no servidor e não vão ao JavaScript público. .env e .env.local estão ignorados pelo Git e pelo Docker. Nunca use prefixo VITE_ para credenciais.

## Acesso e limites do MVP

Abrir a página cria uma sessão de visitante em cookie HttpOnly, Secure em produção, SameSite=Strict, válida por uma hora. O navegador não precisa da credencial interna do backend. Ações de conversa exigem cookie válido e origem do app. Chamadas internas e o proxy local continuam aceitando x-backend-token. A sessão de visitante só libera rotas de conversa, não /api/recordings.

Limites por hora: 10 sessões e 60 respostas por visitante; 300 respostas no total por processo. Máximo de 200 visitantes e 100 conversas ativas. São limites básicos em memória, não autenticação de usuário nem proteção completa contra abuso distribuído. Reiniciar/reimplantar remove sessões e reinicia contadores. Manter uma réplica até existir estado compartilhado e autenticação.

## Desenvolvimento local

Node 22.12+ (build de produção usa Node 24).

1. npm install
2. Preencha backend/.env a partir de backend/.env.example.
3. npm run dev
4. Abra http://127.0.0.1:5173.

Opcionalmente, frontend/.env.local pode apontar BACKEND_URL para a Railway e conter BACKEND_ACCESS_TOKEN. Esses valores são lidos só pelo servidor Vite. O proxy não faz parte do frontend estático; em produção a API está no mesmo domínio.

## Fluxo de voz

Groq Whisper Large V3 Turbo transcreve; GPT-OSS 20B gera a resposta com até 24 mensagens de contexto. A voz usa SpeechSynthesis do navegador: pt-BR para conversa e explicações; en-US, em ritmo um pouco mais lento, para exemplos e exercícios. O modelo retorna trechos separados por idioma, reproduzidos em sequência antes de reabrir a escuta. Se não existir voz da variante exata, procura outra voz do mesmo idioma; a disponibilidade depende do dispositivo. O microfone permanece autorizado durante a sessão, mas o app não grava enquanto o tutor fala. Detecta fim de turno após aproximadamente 1,4 segundo de silêncio; limita fala contínua a 30 segundos e arquivo a 5 MiB. Áudio não é salvo em disco pelo app; ele é enviado à Groq e sujeito às políticas do provedor.

Ainda não permite interromper a fala do tutor. Detecção por amplitude precisa de ajustes conforme ruído e microfone. A qualidade da voz depende do dispositivo. A avaliação de pronúncia Azure, patienceScore, autenticação e histórico Supabase ainda não estão implementados. O modelo não deve inferir pronúncia da transcrição.

## Testar

npm run build
npm test

Testes cobrem healthcheck, áudio, falhas do provedor, contexto, API interna, página pública, sessão do navegador, origem e limites de sessões. O provedor é simulado nos testes; testar uma conversa real no dispositivo continua necessário. Teste permissão negada, três turnos, silêncio, encerrar durante reprodução e durante resposta pendente, microfone desconectado e troca de aba.


## Ensino em português

Alex cumprimenta, explica gramática e vocabulário e responde em português mesmo quando o aluno fala inglês. Os exemplos de inglês são trechos separados, com voz inglesa. Lembretes de silêncio também são em português. O backend valida o formato da resposta e exige que ela comece com um trecho pt-BR. Foram verificados oito testes automatizados e uma resposta real da Groq em português/inglês.

Não há Azure Speech configurado no ambiente publicado. A orientação geral sobre como produzir sons pode ser dada em português, mas não equivale a avaliar a pronúncia do áudio do aluno. Não são inventadas notas ou correções acústicas individuais.
