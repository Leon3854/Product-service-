import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://otel-collector:4318/v1/traces', // Адрес сборщика данных
  }),
  instrumentations: [getNodeAutoInstrumentations()], // Авто-сбор данных из HTTP, gRPC, RabbitMQ и т.д.
});

sdk.start(); // Запуск до старта приложения
