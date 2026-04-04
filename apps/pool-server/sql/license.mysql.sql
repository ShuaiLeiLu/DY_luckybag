CREATE DATABASE IF NOT EXISTS __LICENSE_DB__ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE __LICENSE_DB__;

CREATE TABLE IF NOT EXISTS licenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  license_key VARCHAR(128) NOT NULL,
  customer_name VARCHAR(128) NOT NULL DEFAULT '',
  plan_name VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  expire_at DATETIME NOT NULL,
  max_clients INT NOT NULL DEFAULT 1,
  max_accounts INT NOT NULL DEFAULT 1,
  features_json TEXT NULL,
  bind_client_id VARCHAR(128) NOT NULL DEFAULT '',
  bind_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_license_key (license_key),
  KEY idx_bind_client_id (bind_client_id),
  KEY idx_expire_at (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS license_activations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  license_id BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  account_count INT NOT NULL DEFAULT 0,
  app_version VARCHAR(32) NOT NULL DEFAULT '',
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_license_client (license_id, client_id),
  KEY idx_client_last_seen (client_id, last_seen_at),
  CONSTRAINT fk_license_activations_license
    FOREIGN KEY (license_id) REFERENCES licenses(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS license_bind_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bind_token VARCHAR(128) NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  app_version VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  wechat_open_id VARCHAR(128) NOT NULL DEFAULT '',
  wechat_union_id VARCHAR(128) NOT NULL DEFAULT '',
  wechat_nickname VARCHAR(128) NOT NULL DEFAULT '',
  license_id BIGINT UNSIGNED NULL,
  ad_unlock_days INT NOT NULL DEFAULT 1,
  expire_at DATETIME NOT NULL,
  scanned_at DATETIME NULL,
  granted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bind_token (bind_token),
  KEY idx_bind_client_status (client_id, status),
  KEY idx_bind_expire_at (expire_at),
  CONSTRAINT fk_license_bind_sessions_license
    FOREIGN KEY (license_id) REFERENCES licenses(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS license_trials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fingerprint VARCHAR(128) NOT NULL,
  client_id VARCHAR(128) NOT NULL DEFAULT '',
  app_version VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL,
  expire_at DATETIME NOT NULL,
  activated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_trial_fingerprint (fingerprint),
  KEY idx_trial_client_id (client_id),
  KEY idx_trial_expire_at (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_signin_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id VARCHAR(128) NOT NULL,
  fingerprint VARCHAR(128) NOT NULL DEFAULT '',
  wechat_open_id VARCHAR(128) NOT NULL DEFAULT '',
  sign_date DATE NOT NULL,
  gain_days INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_miniapp_signin_device_day (client_id, fingerprint, sign_date),
  KEY idx_miniapp_signin_openid_day (wechat_open_id, sign_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS license_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO license_settings (
  setting_key,
  setting_value
) VALUES (
  'license_unrestricted',
  '0'
) ON DUPLICATE KEY UPDATE updated_at = NOW();

INSERT INTO licenses (
  license_key,
  customer_name,
  plan_name,
  status,
  expire_at,
  max_clients,
  max_accounts,
  features_json
) VALUES (
  'DEMO-REPLACE-ME-0001',
  'Demo Customer',
  'pro',
  'active',
  DATE_ADD(NOW(), INTERVAL 30 DAY),
  1,
  5,
  JSON_OBJECT('poolServer', true, 'redPacket', true, 'learning', true)
) ON DUPLICATE KEY UPDATE updated_at = NOW();
