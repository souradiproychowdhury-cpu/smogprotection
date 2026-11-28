# 🌫️ Aetheria — Smog Protection & Clean-Air Companion

<p align="center">
  <img src="https://img.shields.io/badge/AI-Powered-7C3AED?style=for-the-badge&logo=google-gemini&logoColor=white" />
  <img src="https://img.shields.io/badge/React-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Node.js-Backend-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-Development-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Deployment-Vercel-black?style=for-the-badge&logo=vercel&logoColor=white" />
</p>

<p align="center">
  <strong>Understand the Air. Protect Your Health. Breathe Smarter.</strong>
</p>

<p align="center">
  <a href="https://smogprotection-aetheria.vercel.app/">
    🌐 <strong>VISIT LIVE APPLICATION</strong>
  </a>
</p>

---

## 🌍 Overview

**Aetheria** is a full-stack, AI-powered air quality intelligence and smog protection platform designed to help individuals, families, and communities navigate severe air pollution and winter smog.

The platform combines real-time air quality monitoring, generative AI recommendations, clean-air route planning, health insights, and intelligent smog alerts into a unified digital experience.

Aetheria goes beyond simply displaying pollution levels. It transforms environmental data into practical, personalized actions that help users make healthier daily decisions.

Whether it is choosing a safer route, improving indoor air quality, understanding pollution exposure, or receiving timely smog alerts, Aetheria acts as your personal clean-air companion.

## ✨ Key Features

### 🌫️ 1. Intelligent Air Quality Monitoring
- Monitor real-time air quality and pollution conditions.
- Understand AQI levels through clear visual indicators.
- Track major air pollutants and environmental conditions.
- Get understandable explanations of changing air quality.
- Access location-based air quality insights.

### 🤖 2. AI-Powered Clean-Air Recommendations
- Personalized recommendations based on location and lifestyle.
- AI-generated daily routines for high-pollution conditions.
- Indoor air purification and ventilation suggestions.
- Sustainable and low-emission lifestyle alternatives.
- Practical guidance for reducing personal pollution exposure.

### 🗺️ 3. Clean-Air Route Intelligence
- Explore alternative routes with potentially lower pollution exposure.
- Make smarter outdoor travel decisions.
- View location-based environmental information.
- Get routing assistance for pollution-conscious journeys.

### 🛡️ 4. Personal Health Shield
- Understand the potential health impact of air pollution.
- Receive activity and outdoor exposure recommendations.
- Access personalized health-protection guidance.
- Discover practical precautions during severe smog conditions.

### 🚨 5. Smart Smog Alerts
- Intelligent alerts for changing pollution conditions.
- Location-aware pollution warnings.
- Timely notifications for potentially unhealthy air quality.
- Actionable suggestions during severe pollution events.

### 🧠 6. AI Environmental Impact Analysis
- Understand how everyday activities influence pollution.
- Explore low-emission lifestyle choices.
- Discover sustainable alternatives.
- Learn how individual decisions contribute to cleaner communities.

### 📱 7. Modern Interactive Experience
- Responsive interface for desktop and mobile devices.
- Progressive Web App (PWA) capabilities.
- Offline-friendly caching with IndexedDB.
- Interactive onboarding and tutorial system.
- Multilingual interface and voice assistance.
- Local notifications and sharing capabilities.

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React, Vite |
| Styling | Tailwind CSS |
| Programming | TypeScript, JavaScript |
| Mapping | Leaflet |
| State Management | Zustand |
| Backend | Node.js, Express.js |
| AI Integration | Google Gemini API |
| Database | SQLite |
| Local Storage | IndexedDB |
| API Architecture | REST API |
| Deployment | Vercel |
| Testing | End-to-End Testing |

## 🏗️ System Architecture

Aetheria follows a modular full-stack architecture that separates the frontend, backend services, shared logic, and persistent data management.

```text
             USER
               |
               v
       AETHERIA WEB APP
        (React + Vite)
               |
       +-------+-------+
       |               |
       v               v
  User Interface   Zustand Store
       |               |
       +-------+-------+
               |
               v
          API CLIENT
               |
               v
       EXPRESS BACKEND
               |
     +---------+----------+
     |         |          |
     v         v          v
  Air Quality  Gemini AI  Routing
   Service     Service   Service
     |         |          |
     +---------+----------+
               |
               v
       SHARED DATA LAYER
               |
       +-------+-------+
       |               |
       v               v
   SQLite DB       IndexedDB
       |               |
       +-------+-------+
               |
               v
    INSIGHTS & RECOMMENDATIONS
               |
               v
         USER DASHBOARD
```

## 📂 Repository Structure

```text
.
├── api/
│   └── index.mjs
│
├── vercel.json
├── package.json
│
└── aetheria/
    ├── client/
    │   ├── public/
    │   └── src/
    │       ├── components/
    │       ├── i18n/
    │       ├── lib/
    │       ├── pages/
    │       ├── store/
    │       ├── tutorial/
    │       └── voice/
    │
    ├── server/
    │   └── src/
    │       ├── config/
    │       ├── db/
    │       ├── prompts/
    │       ├── routes/
    │       └── services/
    │
    ├── shared/
    ├── tutorial/
    └── tests/
```

## ⚙️ Local Installation & Setup

Follow these steps to run Aetheria locally.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

### 2. Navigate to the Project

```bash
cd YOUR_REPOSITORY
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Copy the example environment file:

```bash
cp aetheria/.env.example aetheria/.env
```

Add your required API credentials and configuration values to the environment file.

**Important:** Never upload API keys, passwords, or private credentials to GitHub.

### 5. Start the Development Server

```bash
npm run dev
```

### 6. Access the Application

| Service | Local URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3002 |

For additional setup instructions, refer to `aetheria/README.md`.

## 🔐 Security & Privacy

- API credentials are managed through environment variables.
- Backend services handle external API integrations.
- Local caching supports improved application accessibility.
- User-facing environmental recommendations are designed to support informed decisions.

## 🎯 Project Objectives

Aetheria aims to make air quality information more understandable, accessible, and actionable.

Its core objectives are:

- Promote awareness of air pollution and its health implications.
- Encourage pollution-conscious daily routines.
- Help users make informed outdoor travel decisions.
- Provide AI-powered environmental recommendations.
- Support healthier homes and communities.
- Encourage sustainable, low-emission lifestyles.

## 🚀 Future Enhancements

- Advanced pollution forecasting using historical environmental data.
- Community-based pollution reporting.
- AI-powered personal exposure tracking.
- More intelligent clean-air route optimization.
- Expanded regional language support.
- Advanced environmental analytics and visualization.
- Integration with wearable health and environmental sensors.

## 💡 Why Aetheria?

Air pollution is not just an environmental problem; it is a daily health challenge.

Aetheria bridges the gap between environmental information and everyday decision-making by combining AI, real-time data, intelligent routing, and personalized protection strategies.

**Our vision is simple: make clean-air decisions smarter, easier, and accessible to everyone.**

---

<p align="center">
  <strong>🌿 Aetheria — Breathe Better. Live Smarter.</strong>
</p>

<p align="center">
  Built with ❤️ to create a healthier and cleaner future.
</p>
