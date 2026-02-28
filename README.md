# 🚀 Distributed Product & Inventory System (NestJS + Go + Kafka)

Реализация масштабируемой микросервисной архитектуры для управления каталогом товаров и складскими остатками. Проект спроектирован с упором на **High Availability**, **Event-Driven Design** и **Cloud-Native** принципы.

---

## 🏗 Архитектурные особенности

1. **Polyglot Microservices:** Основная бизнес-логика реализована на **NestJS**, а высоконагруженный модуль складского учета (Inventory) — на **Golang** для минимизации задержек и потребления RAM.
2. **Event-Driven Communication:** Синхронизация данных между сервисами через **Apache Kafka**. Гарантированный порядок событий (Message Ordering) через использование Partition Keys.
3. **Resilience & Caching:** Распределенное кэширование в **Redis** с механизмом **Distributed Locking (SET NX)** для защиты от Race Conditions и Cache Stampede.
4. **Hybrid API:** Поддержка **REST** для внешних интеграций и **GraphQL** (Apollo) для гибких фронтенд-запросов (решена проблема N+1 через Prisma `include`).

---

## 🛠 Технологический стек

- **Languages:** TypeScript (NestJS), Golang (1.21+).
- **Storage:** PostgreSQL (Prisma ORM), Redis (Cache & Rate Limiting).
- **Infrastructure:** Apache Kafka, Docker & Docker Compose.
- **Cloud Native:** **Kubernetes (K8s)**, **Helm Charts**, Liveness/Readiness Probes.
- **CI/CD:** GitHub Actions (автоматическая сборка и валидация).

---

## ☸️ Kubernetes & DevOps Ready

Проект подготовлен к промышленной эксплуатации в K8s:

- **Helm Charts:** Описаны в `/charts`, поддерживают конфигурацию ресурсов (limits/requests).
- **Graceful Shutdown:** Реализована корректная остановка сервисов (завершение транзакций Prisma и закрытие Kafka-консьюмеров).
- **Observability:** Эндпоинты `/health/live` и `/health/ready` для мониторинга состояния оркестратором.

---

## 📜 Техническое задание

Изначальный план и требования к проекту доступны в файле [REQUIREMENTS.md](./REQUIREMENTS.md).
