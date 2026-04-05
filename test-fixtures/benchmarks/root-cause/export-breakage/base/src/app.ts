import { createClient } from './core';

export function initApp(): void {
  createClient('http://api.example.com');
}
