-- Migration legacy plaintext → PBKDF2-SHA256 600k
-- Généré le 2026-05-08T01:57:33.443Z

-- romain@wikot.app (id=1)
UPDATE users SET password_hash_v2 = 'd37784a52331e7c6447bfcac568770b0670ba9e3706ad4b4e3caedb75d77e41d', password_salt = '0af566c5d5b0eb732ddbce501c75ae10', password_algo = 'pbkdf2-sha256-100k', password_hash = '' WHERE id = 1;

-- Laura@gmail.com (id=3)
UPDATE users SET password_hash_v2 = 'd5d379c771a1b92451bb3afadb6d241e18c23bc99449c9cb91e3b335f89030c2', password_salt = 'd178e59704f020fefd4a837e16d5aab1', password_algo = 'pbkdf2-sha256-100k', password_hash = '' WHERE id = 3;

-- Doriane@gmail.com (id=4)
UPDATE users SET password_hash_v2 = '249c9fa8e8309bc3d5e932a3ea83dd54343293ff1e9f36ebce1c645561b5fb1a', password_salt = 'a875dc8e127cc0dd0adf3355dd1ca479', password_algo = 'pbkdf2-sha256-100k', password_hash = '' WHERE id = 4;

-- Pauline@gmail.com (id=5)
UPDATE users SET password_hash_v2 = '7b51216a6fb2a5caddef1295076cf756cbcb9049c72e971615656dd840ed6f19', password_salt = '030f453fd9db7283b51d39a3591ac230', password_algo = 'pbkdf2-sha256-100k', password_hash = '' WHERE id = 5;

-- Florence@gmail.com (id=6)
UPDATE users SET password_hash_v2 = '1a5c775fd3d54b8c23c8bcd0e2e84d569ca10bee0b0bf504a1d1ef57d737c1ae', password_salt = 'bda557f3afefbdcb7fd02e510230e07a', password_algo = 'pbkdf2-sha256-100k', password_hash = '' WHERE id = 6;

