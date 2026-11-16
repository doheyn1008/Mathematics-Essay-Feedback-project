import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('membership writes cannot use a role read before an administrator changed the profile', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const directory = new URL('../drizzle/', import.meta.url);
    database.exec('PRAGMA foreign_keys = ON');
    for (const filename of readdirSync(directory).filter(path => path.endsWith('.sql')).sort()) {
      database.exec(readFileSync(new URL(filename, directory), 'utf8'));
    }

    const timestamp = '2026-11-16T00:00:00Z';
    const seedProfile = database.prepare('INSERT INTO product_profiles VALUES (?, ?, ?, ?)');
    seedProfile.run('historical-student', 'academy_student', '학생', timestamp);
    seedProfile.run('current-teacher', 'teacher', '선생님', timestamp);
    database.prepare('INSERT INTO product_classes VALUES (?, ?, ?, ?, ?)').run(
      'room', 'SCODE', 'TCODE', '{"name":"수업","billingTeacherId":"current-teacher"}', timestamp,
    );
    const writeMembership = database.prepare('INSERT OR IGNORE INTO product_members VALUES (?, ?, ?, ?, ?)');
    const staleRole = database.prepare('SELECT account_type FROM product_profiles WHERE user_id = ?')
      .get('historical-student').account_type;
    assert.equal(staleRole, 'academy_student');
    database.prepare('UPDATE product_profiles SET account_type = ? WHERE user_id = ?')
      .run('personal', 'historical-student');
    assert.throws(
      () => writeMembership.run('room', 'historical-student', 'student', '학생', timestamp),
      /PRODUCT_MEMBER_ROLE_MISMATCH/,
    );
    writeMembership.run('room', 'current-teacher', 'teacher', '선생님', timestamp);
    assert.throws(
      () => database.prepare('UPDATE product_members SET role = ? WHERE user_id = ?')
        .run('student', 'current-teacher'),
      /PRODUCT_MEMBER_ROLE_MISMATCH/,
    );
    assert.deepEqual(
      database.prepare('SELECT user_id, role FROM product_members').all().map(row => [row.user_id, row.role]),
      [['current-teacher', 'teacher']],
    );
  } finally {
    database.close();
  }
});
