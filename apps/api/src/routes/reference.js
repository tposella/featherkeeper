// Reference photos of a species (see integrations/reference.js). Public: it only describes species.
export default async function referenceRoutes(app, { reference }) {
  app.get(
    '/reference',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        querystring: {
          type: 'object',
          required: ['scientificName'],
          properties: {
            scientificName: { type: 'string', minLength: 3, maxLength: 200 },
            commonName: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const info = await reference.forSpecies(request.query.scientificName, request.query.commonName);
      reply.header('Cache-Control', 'public, max-age=86400');
      return info;
    },
  );
}
