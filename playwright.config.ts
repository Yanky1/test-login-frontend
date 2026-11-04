import { defineConfig } from '@playwright/test'
import path from 'node:path'

const backendDir = path.resolve(process.env.BACKEND_DIR ?? '../Yanky1-test-login-backend')
const e2eDir = path.resolve('.e2e')

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      // Real backend: Testing environment, SQLite, in-memory email sink, Turnstile test keys (offline stub).
      command: `dotnet run --project ${path.join(backendDir, 'src/Solvelt.Api')} --no-launch-profile --urls http://localhost:5080`,
      url: 'http://localhost:5080/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Testing',
        Database__ConnectionString: `Data Source=${path.join(e2eDir, 'e2e.db')}`,
        Storage__LocalRoot: path.join(e2eDir, 'uploads'),
        App__UseHttpsRedirection: 'false',
        App__HmacSecret: 'e2e-hmac-secret-0123456789abcdef',
        App__FrontendBaseUrl: 'http://localhost:5173',
        App__CorsOrigins__0: 'http://localhost:5173',
        Email__Provider: 'Sink',
        Email__SendInBackground: 'false',
        Turnstile__UseTestStub: 'true',
        Turnstile__SecretKey: '1x0000000000000000000000000000000AA',
        Turnstile__SiteKey: '1x00000000000000000000AA',
        AdminSeed__Email: 'admin@example.com',
        AdminSeed__Password: 'Qu1et-Marble-Fox-Test!',
        RateLimit__AuthPerMinute: '100000',
        RateLimit__SensitivePerMinute: '100000',
        RateLimit__TeamPerMinute: '100000',
        Passkeys__RelyingPartyId: 'localhost',
        Passkeys__AllowedOrigins__0: 'http://localhost:5173',
        Session__IdleTimeoutMinutes: '20',
        Orders__InboundSecret: 'e2e-inbound-secret-0123456789abcdef',
        Orders__OutboundSecret: 'e2e-outbound-secret-fedcba9876543210',
        RateLimit__OrdersPerMinute: '100000',
        RateLimit__CatalogPerMinute: '100000',
        RateLimit__AssistantPerMinute: '100000',
        Assistant__Enabled: 'true',
        Assistant__Provider: 'Fake',
        RateLimit__PaymentsPerMinute: '100000',
        Payments__NewSellerReservePercent: '0',
        RateLimit__ShippingPerMinute: '100000',
        Shipping__WebhookSecret: 'e2e-shipping-webhook-secret-0123456789',
        Shipping__RefundCheckMinutes: '0',   // the fake provider confirms a label refund on the next maintenance run
        Phone__Enabled: 'true',
        Phone__Provider: 'Sink',
        Phone__SigningKey: 'e2e-phone-signing-key',
        Phone__SendInBackground: 'false',
      },
    },
    {
      command: 'npm run dev -- --host localhost',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_TARGET: 'http://localhost:5080' },
    },
  ],
})
