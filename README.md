# Painel ADM do Quim Game

O painel inclui uma API no mesmo projeto Vercel. O catálogo inicial é carregado de `data/recipes.json`; depois que Redis estiver configurado, as alterações são gravadas em um banco compartilhado.

## Publicar no Vercel

1. Crie um banco Redis no Upstash e conecte-o ao projeto do painel. O Vercel/Marketplace deve fornecer `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` ao projeto.
2. No projeto Vercel, defina `ADMIN_API_TOKEN` com um segredo longo e aleatório. Guarde-o em um gerenciador de senhas. Ele nunca é salvo pelo painel no navegador.
3. Defina `ALLOWED_ORIGINS` como `https://quim-game-adm.vercel.app,https://quim-game.vercel.app`. A origem do próprio painel também é aceita automaticamente.
4. Importe esta pasta como projeto no Vercel, usando `outputs/admin-panel` como Root Directory, e publique. Se o projeto já existir, atualize seu Root Directory para essa pasta.
5. Abra o painel publicado, informe o `ADMIN_API_TOKEN` e clique em **Conectar API**.

A primeira leitura serve o catálogo inicial. A primeira gravação cria a cópia persistente no Redis. Se houver um rascunho neste navegador diferente do catálogo online, o painel o mantém separado e pede que você escolha publicá-lo ou descartá-lo. O token permanece apenas na memória da página.

## Endpoints

- `GET /api/recipes`: leitura pública do catálogo; aceita chamadas do jogo quando a origem estiver autorizada.
- `POST /api/recipes`: valida o token ADM e informa se a persistência está configurada.
- `PUT /api/recipes`: substitui o catálogo completo; exige `Authorization: Bearer <ADMIN_API_TOKEN>`.

A API permite leitura pública para a futura integração do jogo, mas só aceita gravações com o token de administrador. O jogo ainda não foi conectado nesta etapa.

## Uso local

Ao abrir `index.html` como arquivo, o painel continua em modo local e usa o armazenamento do navegador, sem chamadas de API. Exporte um JSON para transferir alterações feitas nesse modo para o painel publicado.
