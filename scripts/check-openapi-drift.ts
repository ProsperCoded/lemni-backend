import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

// Post-processing function to remove auth from public endpoints
function removeAuthFromPublicEndpoints(document: any): any {
  const publicEndpoints = [
    '/admin/billing/subscriptions/{id}/unsubscribe/request',
    '/admin/billing/subscriptions/{id}/unsubscribe/confirm',
  ];

  for (const endpointPath of publicEndpoints) {
    if (document.paths[endpointPath]) {
      for (const method of Object.keys(document.paths[endpointPath])) {
        const operation = document.paths[endpointPath][method];
        // Set security to empty array to indicate no auth required
        operation.security = [];
      }
    }
  }

  return document;
}

async function bootstrap() {
  // Bootstrap the application in headless mode (without starting HTTP server listener)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  // Dummy mock express app context to extract HTTP routing metadata using SwaggerModule
  const expressApp = await NestFactory.create(AppModule, { logger: false });
  
  const config = new DocumentBuilder()
    .setTitle('LEMNI PaaS Core Engine API')
    .setDescription('Deterministic, highly resilient backend infrastructure for the Lemni Payment-as-a-Service (PaaS) engine.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
    
  let document = SwaggerModule.createDocument(expressApp, config);
  await expressApp.close();
  await app.close();

  // Post-process: Remove bearer auth from public endpoints
  document = removeAuthFromPublicEndpoints(document);

  // Convert schema object to a sorted, deterministic YAML string
  const cleanDocument = JSON.parse(JSON.stringify(document));
  const generatedYaml = yaml.dump(cleanDocument, {
    noRefs: true,
    sortKeys: true,
    lineWidth: 120,
  });

  const specDir = path.join(__dirname, '../docs/openapi');
  const specPath = path.join(specDir, 'openapi.yaml');

  const args = process.argv.slice(2);
  const isWriteMode = args.includes('--write');

  if (isWriteMode) {
    if (!fs.existsSync(specDir)) {
      fs.mkdirSync(specDir, { recursive: true });
    }
    fs.writeFileSync(specPath, generatedYaml, 'utf8');
    console.log('✅ Successfully wrote updated OpenAPI spec to docs/openapi/openapi.yaml');
    process.exit(0);
  }

  if (!fs.existsSync(specPath)) {
    console.error(`❌ Error: Canonical OpenAPI spec file not found at ${specPath}`);
    console.error('Run "pnpm lint:openapi -- --write" to generate it initially.');
    process.exit(1);
  }

  const existingYaml = fs.readFileSync(specPath, 'utf8');

  // Parse and re-dump existing YAML to ensure formatting is identical for comparison
  const parsedExisting = yaml.load(existingYaml);
  const formattedExisting = yaml.dump(parsedExisting, {
    noRefs: true,
    sortKeys: true,
    lineWidth: 120,
  });

  if (formattedExisting.trim() !== generatedYaml.trim()) {
    console.error('❌ Mismatch detected: The live NestJS API routes have drifted from docs/openapi/openapi.yaml!');
    console.error('Please reconcile the code or run "pnpm lint:openapi -- --write" if the changes are intentional.');
    process.exit(1);
  }

  console.log('✅ OpenAPI contract is fully in sync with the codebase.');
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('Error running OpenAPI drift check:', err);
  process.exit(1);
});
