import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Sem isto o vitest compila o JSX para React.createElement e um teste que
  // renderiza um componente .tsx falha com "React is not defined". O
  // tsconfig.json da raiz não diz nada sobre JSX; quem sabe é o tsconfig.app.json.
  esbuild: { jsx: 'automatic' },
  test: {
    // Os testes de integração sobem um servidor Socket.IO de verdade e trocam
    // eventos por rede local. Sob contenção de CPU o round-trip passa dos 5s
    // padrão do vitest e o teste de privacidade estourava por tempo — uma falha
    // por ~18 execuções, sempre com "Timeout esperando guess:result", nunca por
    // lógica errada.
    //
    // Prazo não é asserção: ele existe só para a suíte não travar para sempre.
    // Aumentá-lo não reduz o poder de discriminação de teste nenhum — se o
    // evento não chegar, o teste continua falhando, só que mais tarde. E um
    // teste de privacidade instável é pior que a média: ensina a tratar falha
    // como ruído, que é exatamente como uma falha real passaria batida.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
