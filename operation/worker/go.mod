module kiao/worker

go 1.27.3

require (
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/gorilla/websocket v1.5.3
	github.com/ledongthuc/pdf v0.0.0-20250511090121-5959a4027728
	kiao/skills v0.0.0
)

replace kiao/skills => ../../reference/kiao-skills
