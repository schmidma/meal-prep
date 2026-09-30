declare global {
  namespace App {
    interface Locals {
      user?: { id: string; email: string; name: string };
      household?: import('$lib/account').Household;
    }
  }
}
export {};
