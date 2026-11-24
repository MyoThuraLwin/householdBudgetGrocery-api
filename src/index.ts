import express from "express";
import { createApp } from "./app.js";

// Vercel's Express entry point exports a handler without opening a local port.
const app: ReturnType<typeof express> = createApp();
export default app;
