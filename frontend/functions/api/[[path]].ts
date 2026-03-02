// frontend/functions/api/[[path]].ts

interface Env {
  LATEX_WORKER: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  // Simplemente reenvía la petición original al worker a través del binding.
  // Cloudflare se encarga de la comunicación interna de forma eficiente.
  // Esto preserva el método, los headers (incluyendo el de autenticación) y el cuerpo.
  return context.env.LATEX_WORKER.fetch(context.request);
};
