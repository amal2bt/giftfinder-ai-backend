# ⚙️ GiftFinder AI — Backend API

The RESTful backend service powering the **GiftFinder AI** ecosystem. Built with **Node.js** and **Express**, it orchestrates AI-driven gift recommendation logic, user authentication, and real-time data synchronization across both the mobile application and web admin panel.

## ✨ Key Features
- **AI Recommendation Engine:** Processes recipient profiles, occasions, interests, and budget constraints to generate personalized gift suggestions.
- **Modular MVC Architecture:** Clean separation of concerns across `routes/`, `controllers/`, `services/`, `middleware/`, and `utils/`.
- **Authentication & Role-Based Middleware:** Secures protected API endpoints and enforces administrative access controls.
- **Relational Database Integration:** Backed by **Supabase (PostgreSQL)** with a structured relational schema (`supabaseSchema.sql`)[cite: 1].

## 🛠️ Tech Stack
- **Runtime & Framework:** Node.js, Express.js (`server.js`)
- **Database:** Supabase (PostgreSQL)
- **Architecture:** RESTful API, Layered Service/Controller Pattern

## 🔗 Ecosystem Repositories
- **Web Admin Panel:** [giftfinder-ai-web](https://github.com/amal2bt/giftfinder-ai-web)
- **Mobile App:** [giftfinder-ai-mobile](https://github.com/amal2bt/giftfinder-ai-mobile)

## 📄 License
Copyright (c) 2026 Amal Barakat. All Rights Reserved. See the [LICENSE](./LICENSE) file for details.
