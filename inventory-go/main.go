/*
*
* Этот сервис будет «слушать» Kafka и мгновенно реагировать на товары, созданные в NestJS.
* Вынес складской учет в Go, чтобы гарантировать минимальные задержки при обновлении
* остатков
 */
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/segmentio/kafka-go"
)

func main() {
	// Берем адрес Kafka из переменной окружения (которую прокинет Docker)
	kafkaURL := os.Getenv("KAFKA_BROKERS")
	if kafkaURL == "" {
		// kafkaURL = "localhost:9092" 
		kafkaURL = "kafka:29092"
	}

	topic := "product.created"
	groupID := "inventory-group-go"

	// Настраиваем Reader (Consumer)
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{kafkaURL},
		GroupID:  groupID,
		Topic:    topic,
		MinBytes: 10e3, // 10KB
		MaxBytes: 10e6, // 10MB
	})

	defer reader.Close()

	fmt.Println("🐹 Go Inventory Service started. Waiting for NestJS events...")

	for {
		// Читаем сообщение
		m, err := reader.ReadMessage(context.Background())
		if err != nil {
			log.Printf("❌ Error reading message: %v", err)
			continue
		}

		// Выводим "привет" от NestJS
		fmt.Printf("📦 [Go Service] New product detected! ID: %s | Data: %s\n", string(m.Key), string(m.Value))
		
		// Тут в будущем будет логика: 
		// db.Exec("INSERT INTO stock (product_id, count) VALUES (?, ?)", id, 100)
	}
}