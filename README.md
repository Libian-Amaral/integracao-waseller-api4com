# Integração WaSeller ⇄ API4COM

Ponte que conecta o **CRM WaSeller** à **API de voz API4COM**. Toda vez que um lead entra no WaSeller, o número dele é capturado automaticamente; a equipe abre um painel, clica em **"Ligar"** e a chamada é disparada pela API4COM — sem ninguém digitar número. Quando a ligação termina, o resultado (duração e link da gravação) é gravado de volta como **nota** no contato do WaSeller.

---

## Como funciona

1. **Lead entra no WaSeller** → o WaSeller dispara um *webhook* (evento "CRM") para este serviço, que guarda o lead (número + nome).
2. **A equipe abre o painel** (`/`) → vê a lista de leads recebidos, cada um com um botão "Ligar".
3. **Clique em "Ligar"** → o serviço chama a API4COM (`POST /dialer`): ela toca primeiro no ramal do atendente e, ao ser atendida, conecta no número do lead.
4. **Fim da ligação** → a API4COM dispara um *webhook* de retorno; o serviço registra duração + gravação e cria uma **nota** no contato do WaSeller (`POST /api/criar-nota`). Opcionalmente, aplica uma **etiqueta** de resultado.

> **Observação importante sobre o API4COM:** ele é uma API de *voz* — não tem cadastro de contatos. Por isso os leads não "aparecem" como uma lista dentro do API4COM. Eles ficam neste serviço (no painel), e cada ligação é amarrada ao lead pelo campo `metadata` da chamada. O resultado prático é o mesmo que você queria: ninguém copia número manualmente.

---

## O que você vai precisar

- **Token da API4COM** (gerado com um script incluído aqui).
- **Ramal (extension) da API4COM** que fará as ligações — você encontra no Webphone da API4COM.
- **Token da API do WaSeller** — no WaSeller: módulo **"API" → "Configurar API"**.
- Uma conta gratuita no **[Render.com](https://render.com)** (ou Railway) para hospedar o serviço.
- O **WhatsApp Web / WaSeller** aberto e conectado no computador do escritório (a API do WaSeller exige isso — veja "Pontos de atenção" no fim).

---

## Estrutura do projeto

```
integracao-waseller-api4com/
├── server.js                      # Servidor principal (webhooks + painel + ligar)
├── package.json
├── .env.example                   # Modelo de configuração (copie para .env)
├── lib/
│   ├── api4com.js                 # Cliente da API4COM
│   ├── waseller.js                # Cliente da API do WaSeller
│   ├── phone.js                   # Normalização de números de telefone
│   └── store.js                   # Armazenamento dos leads (arquivo JSON)
├── views/
│   └── painel.html                # Painel de ligações
└── scripts/
    ├── gerar-token-api4com.js      # Gera o token permanente da API4COM
    ├── setup-api4com.js            # Registra o webhook de retorno na API4COM
    └── listar-etiquetas-waseller.js# Lista as etiquetas do WaSeller (e seus IDs)
```

---

## Passo a passo da instalação

### Passo 1 — Testar localmente (opcional, mas recomendado)

Precisa do **Node.js 18 ou superior** instalado ([nodejs.org](https://nodejs.org)).

```bash
# dentro da pasta do projeto:
npm install
cp .env.example .env        # no Windows: copy .env.example .env
```

Abra o arquivo `.env` e preencha os campos (veja o Passo 3 para detalhes de cada um).
Depois, para rodar:

```bash
npm start
```

O serviço sobe em `http://localhost:3000`. Abra no navegador para ver o painel.

### Passo 2 — Gerar o token da API4COM

```bash
npm run gerar-token:api4com
```

O script pede seu **e-mail e senha da API4COM**, faz o login e cria um token **permanente**. Copie a linha `API4COM_TOKEN=...` que ele mostrar e cole no seu `.env`.

### Passo 3 — Preencher o arquivo `.env`

| Variável | O que é |
|---|---|
| `WEBHOOK_SECRET` | Uma palavra longa e aleatória que você inventa. Faz parte da URL dos webhooks e impede que pessoas de fora os disparem. |
| `PUBLIC_URL` | Endereço público do serviço. Você preenche **depois** do deploy (Passo 4). |
| `PAINEL_USUARIO` / `PAINEL_SENHA` | Usuário e senha para abrir o painel. Recomendado preencher. |
| `API4COM_TOKEN` | Token gerado no Passo 2. |
| `API4COM_EXTENSION` | Número do ramal que fará as ligações (ex: `1000`). |
| `WASELLER_TOKEN` | Token da API do WaSeller (módulo "API" → "Configurar API"). |
| `WASELLER_REGISTRAR_NOTA` | `true` para gravar uma nota no lead ao fim da ligação. |
| `WASELLER_LABEL_ATENDIDA` / `WASELLER_LABEL_NAO_ATENDIDA` | (Opcional) IDs de etiquetas para marcar o resultado. Deixe em branco para não usar. Para descobrir os IDs: `node scripts/listar-etiquetas-waseller.js`. |

> **Nunca compartilhe o arquivo `.env` preenchido.** Ele contém credenciais. O arquivo já está no `.gitignore`.

### Passo 4 — Publicar no Render.com

1. Crie uma conta em [render.com](https://render.com).
2. Suba esta pasta para um repositório (GitHub/GitLab) **ou** use a opção de deploy manual do Render.
3. No Render: **New → Web Service**, aponte para o repositório.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** o plano gratuito já funciona para começar.
4. Em **Environment**, adicione **todas** as variáveis do seu `.env` (uma a uma).
5. Faça o deploy. O Render vai te dar uma URL, por exemplo: `https://integracao-waseller-api4com.onrender.com`.
6. Copie essa URL e atualize a variável `PUBLIC_URL` (no `.env` local **e** nas variáveis do Render).
7. Para confirmar que está no ar, abra `https://SUA-URL/health` — deve responder `{ "ok": true, ... }`.

### Passo 5 — Registrar o webhook de retorno na API4COM

Com `API4COM_TOKEN`, `PUBLIC_URL` e `WEBHOOK_SECRET` preenchidos, rode:

```bash
npm run setup:api4com
```

Isso registra na API4COM o endereço que receberá o aviso de fim de chamada:
`https://SUA-URL/webhook/api4com/SEU-WEBHOOK_SECRET`

### Passo 6 — Configurar o webhook no WaSeller

No WaSeller, abra o módulo **WebHook** e, no evento **"CRM"**:

1. No campo **"URL do WebHook"**, cole:
   `https://SUA-URL/webhook/waseller/SEU-WEBHOOK_SECRET`
2. Em **"Dados a enviar"**, deixe marcados pelo menos **"Numero"** e **"Nome"** (e pode manter "Dados do Evento").
3. Ligue o botão **"Ativo"**.

### Passo 7 — Testar de ponta a ponta

1. Faça um lead entrar no funil do WaSeller (ou mova um lead, conforme o evento "CRM" dispara).
2. O lead deve aparecer no **painel** (`https://SUA-URL/`) em poucos segundos.
   - Se não aparecer, confira no WaSeller, na tela do WebHook, a seção **"Últimos 30 envios"** — ela mostra o que foi enviado. Os mesmos dados aparecem nos *logs* do serviço no Render.
3. No painel, clique em **"Ligar"**. O ramal configurado deve tocar; ao atender, conecta no lead.
4. Encerre a ligação. Em instantes, o status no painel muda para "Atendida"/"Não atendida" e uma **nota** é criada no contato dentro do WaSeller.

---

## Uso no dia a dia

A equipe só precisa manter aberta a página do **painel** (`https://SUA-URL/`). Os leads aparecem sozinhos conforme entram no WaSeller; basta clicar em "Ligar". A lista atualiza automaticamente a cada 20 segundos.

---

## Pontos de atenção

- **A API do WaSeller depende do WhatsApp Web aberto.** O WaSeller é uma extensão que funciona sobre o WhatsApp Web. Se o WhatsApp Web/WaSeller estiver fechado ou desconectado, a API responde erro **501** e a nota não é gravada (a ligação em si, pela API4COM, continua funcionando). Mantenha o computador do escritório com o WhatsApp Web aberto e conectado.
- **Formato do webhook do WaSeller.** A documentação do WaSeller não detalha o JSON exato enviado pelo webhook. Por isso o serviço foi feito para procurar o número e o nome de forma tolerante (testando vários nomes de campo) e **registra nos logs todo o conteúdo recebido**. Na primeira vez que um lead real chegar, vale conferir os logs (no Render) para confirmar que o número foi reconhecido. Se algum campo vier com nome diferente, é um ajuste de uma linha em `server.js` (lista `buscarCampo`).
- **Versão do webhook da API4COM.** A documentação da API4COM tem uma pequena divergência: o guia de integração cita uma versão antiga e a referência da API indica a versão `1.8`. O serviço usa `1.8` (a indicada na referência). Se o webhook de retorno não chegar, este é o primeiro ponto a verificar — em `lib/api4com.js`, função `registrarWebhook`.
- **Plano gratuito do Render.** No plano free, o serviço "hiberna" após um tempo sem uso e o disco é efêmero (o histórico de leads pode ser zerado em reinícios). Isso não quebra a integração — os leads voltam a aparecer conforme novos webhooks chegam. Para um uso intenso, considere um plano pago com disco persistente.
- **Segurança.** O `WEBHOOK_SECRET` faz parte das URLs dos webhooks; trate-o como senha. O painel é protegido por usuário/senha (`PAINEL_USUARIO`/`PAINEL_SENHA`) — recomendado preencher.
- **Vários atendentes.** Esta versão usa um único ramal (`API4COM_EXTENSION`). Se no futuro você quiser que cada atendente ligue pelo próprio ramal, é uma evolução possível — me avise.

---

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| Lead não aparece no painel | WebHook do WaSeller está "Ativo" e com a URL correta? Veja "Últimos 30 envios" no WaSeller e os logs no Render. |
| Erro ao clicar em "Ligar" | `API4COM_TOKEN` e `API4COM_EXTENSION` corretos? O ramal existe na API4COM? Há saldo/créditos na conta? |
| Ligação acontece, mas a nota não é criada no WaSeller | O WhatsApp Web/WaSeller está aberto e conectado? (erro 501). `WASELLER_TOKEN` correto? `WASELLER_REGISTRAR_NOTA=true`? |
| Webhook de retorno da API4COM não chega | Rodou `npm run setup:api4com`? `PUBLIC_URL` está certa? Confira a versão do webhook em `lib/api4com.js`. |
| Painel pede senha e não entra | Confira `PAINEL_USUARIO` / `PAINEL_SENHA` nas variáveis de ambiente. |

---

## Fontes (documentação oficial usada)

- API4COM — Introdução, Autenticação, Realizar chamadas e Integrações de usuário: <https://developers.api4com.com>
- WaSeller (Wascript API) — Swagger: <https://api-whatsapp.wascript.com.br/api-docs/>
