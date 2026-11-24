import express from "express";
import { createApp } from "./dist/application.js";

// Vercel loads the ESM output already checked and compiled by our build command.
// Keep this as the only Express entry point detected by Vercel.
export default createApp(express());
