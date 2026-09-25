import express from 'express';
import cors from 'cors';
import router from './routes/index.js';
// documentação da api
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import YAML from 'yaml';

const openapiFile = fs.readFileSync('./docs/openapi.yaml', 'utf8');
const swaggerDocument = YAML.parse(openapiFile);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

app.get('/', (req, res) => {
  res.send('Simple Todo API');
});

app.get('/health', (req, res) => {
  res.send('Simple Todo API is healthy');
});

app.use('/api', router);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export default app;