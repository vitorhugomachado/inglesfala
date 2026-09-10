# Tutor de inglês — conversa por voz

A tela tem um botão para ligar o microfone e outro para encerrar a sessão. Alex começa a conversa, recebe a resposta automaticamente após uma pausa e propõe a próxima pergunta ou exercício. A captura para enquanto o tutor fala, evitando que a própria voz seja enviada como resposta.

## Configurar e executar

1. Preencha GROQ_API_KEY no arquivo backend/.env. A chave fica somente no servidor; não use variáveis VITE_ para segredos. O arquivo já está ignorado pelo Git.
2. Na pasta deste README, execute npm install (se necessário) e npm run dev.
3. Abra http://127.0.0.1:5173, ligue o microfone e permita o acesso.
4. Depois de alterar .env, reinicie o backend.

Node 22.12+; validado com Node 24. Backend em 127.0.0.1:3001. O .env é carregado pelo servidor tanto em desenvolvimento quanto no build. PORT e HOST são configuráveis. Se alterar PORT, ajuste o proxy em frontend/vite.config.ts.

## Fluxo implementado

- Uma permissão de microfone por sessão. Áudio com cancelamento de eco e redução de ruído.
- Fim do turno após aproximadamente 1,4 segundo de silêncio, usando amplitude do áudio. Limite de 30 segundos após o início da fala e de 5 MiB por envio.
- Groq Whisper Large V3 Turbo transcreve o áudio, inclusive português; GPT-OSS 20B responde com contexto e conduz os exercícios.
- Voz do navegador via SpeechSynthesis, em inglês. A qualidade depende das vozes instaladas. Explicações em português podem ter sotaque inglês nesta versão.
- Saudação e lembretes de silêncio são fixos; as respostas aos alunos vêm do modelo. Não existe conversa simulada caso a chave esteja ausente.
- Encerrar libera microfone, cancela requisições do navegador, interrompe a voz e remove a sessão. Ao trocar de aba, a sessão também é encerrada. Uma chamada que já chegou ao provedor pode terminar no servidor.
- Sessões em memória, até 24 mensagens de contexto, expiração após 30 minutos de inatividade. Reiniciar o backend remove as sessões. Áudio não é gravado em disco; ele é enviado à Groq. As políticas do provedor se aplicam ao processamento externo.

## Limitações desta etapa

A conversa alterna turnos automaticamente; ainda não permite interromper a fala do tutor. A detecção de silêncio é simples e precisa de calibração com microfones reais, especialmente em ambientes ruidosos. O app não foi validado com microfone e voz reais em uma chamada à Groq porque a chave ainda não está configurada.

Azure Speech, pontuação de pronúncia e fonemas, patienceScore, Supabase e Railway continuam pendentes. O modelo foi instruído a não inferir pronúncia de transcrições. A voz atual é a do navegador, não TTS neural contratado.

Este é um MVP local, sem autenticação nem proteção de uso por usuário. Antes de publicar: adicionar autenticação, limites de consumo e encaminhamento de /api no host. O proxy Vite funciona em dev/preview, não no build estático de produção.

## API

- GET /health — saúde do servidor.
- GET /api/conversation/status — configuração presente (não valida a chave com o provedor).
- POST /api/conversation — cria sessão e retorna id e saudação.
- POST /api/conversation/:id/turn — recebe Blob de áudio webm, mp4 ou ogg; retorna transcript e reply.
- DELETE /api/conversation/:id — encerra a sessão.
- POST /api/recordings — endpoint da etapa anterior preservado, sem uso na nova interface.

## Verificação

npm run build
npm test

Os testes verificam healthcheck, recebimento de áudio, ausência de chave, contexto, falhas do provedor e encerramento. Chamadas à Groq são simuladas nos testes; não comprovam a integração externa.

Teste manual: permitir e negar microfone; conversar por três turnos; fazer pausa; encerrar durante a fala e durante uma resposta pendente; desconectar o microfone; testar em ambiente ruidoso. Ao encerrar, confira que o indicador de uso do microfone se apaga.

Referências: https://console.groq.com/docs/speech-to-text e https://console.groq.com/docs/api-reference.

## Railway — backend publicado

Projeto: voice-english-tutor (9f662fb7-8199-46c4-8a7b-8535e3c083e1).
Serviço: tutor-api (53a08f67-23c2-4aec-8b2c-25054561e4c3).

Dockerfile com Node 24, compilação TypeScript e execução como usuário não-root. railway.json define /health, uma réplica e reinício por falha. O pacote de deploy é montado por lista explícita de arquivos em work/railway-deploy, fora desta pasta, sem .env ou credenciais.

Em produção são obrigatórias GROQ_API_KEY e BACKEND_ACCESS_TOKEN. A API exige o cabeçalho x-backend-token; /health permanece público. O proxy Vite suporta BACKEND_URL e BACKEND_ACCESS_TOKEN em frontend/.env.local (valores apenas do servidor, não expostos por VITE_). As credenciais foram configuradas nas variáveis Railway com autorização do proprietário. O deploy foi concluído e o healthcheck validado. Nenhum segredo é versionado no GitHub.

As sessões continuam em memória, sem banco de dados. Uma nova implantação encerra as sessões existentes. A credencial do proxy restringe o MVP ao frontend local; autenticação de usuários e limites de consumo ainda serão necessários antes de disponibilizar o frontend ao público.


Repositório: https://github.com/vitorhugomachado/inglesfala (branch main).
Backend: https://tutor-api-production-088a.up.railway.app
Healthcheck público: https://tutor-api-production-088a.up.railway.app/health

A Railway está conectada ao GitHub e acompanha main. O frontend permanece local em http://127.0.0.1:5173; seu proxy lê o endereço Railway e a credencial de frontend/.env.local. Em outro computador, configure esses valores localmente. A URL do backend não serve a interface.

Validação publicada: healthcheck 200, API sem token 401, API com token 200 e criação/encerramento de sessão 200. Testes automatizados usam provedor simulado; a conversa com áudio real ainda deve ser validada pelo aluno.
