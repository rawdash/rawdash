import { describe, expect, it } from 'vitest';

import {
  highestPlaceholder,
  isReadOnlySql,
  readOnlySqlIssues,
  stripSqlNoise,
  stripTrailingSemicolon,
} from './sql-guard';

describe('stripSqlNoise', () => {
  it('removes line and block comments', () => {
    expect(
      stripSqlNoise('select 1 -- drop table users\n, 2 /* insert */'),
    ).not.toMatch(/drop|insert/);
  });

  it('handles nested block comments', () => {
    const stripped = stripSqlNoise('select /* a /* b */ delete */ 1');
    expect(stripped).not.toMatch(/delete/);
    expect(stripped).toMatch(/select/);
  });

  it('removes single- and double-quoted literals', () => {
    expect(
      stripSqlNoise(`select 'drop table t' as x, "delete" as y`),
    ).not.toMatch(/drop|delete/);
  });

  it('handles doubled quotes inside literals', () => {
    expect(stripSqlNoise(`select 'it''s fine drop' as x`)).not.toMatch(/drop/);
  });

  it('removes dollar-quoted blocks but keeps positional placeholders', () => {
    const stripped = stripSqlNoise(
      'select $tag$ delete from t $tag$, $1, $$insert$$, $2',
    );
    expect(stripped).not.toMatch(/delete|insert/);
    expect(stripped).toContain('$1');
    expect(stripped).toContain('$2');
  });
});

describe('readOnlySqlIssues', () => {
  it('accepts plain selects and CTEs', () => {
    expect(isReadOnlySql('select count(*) from users')).toBe(true);
    expect(
      isReadOnlySql('with recent as (select 1 as v) select v from recent'),
    ).toBe(true);
    expect(isReadOnlySql('values (1), (2)')).toBe(true);
  });

  it('accepts a trailing semicolon', () => {
    expect(isReadOnlySql('select 1;')).toBe(true);
    expect(isReadOnlySql('select 1;  \n')).toBe(true);
  });

  it('rejects multiple statements', () => {
    expect(readOnlySqlIssues('select 1; select 2')).toContainEqual(
      expect.stringContaining('single statement'),
    );
  });

  it('rejects non-select leading keywords', () => {
    expect(readOnlySqlIssues('explain select 1')).toContainEqual(
      expect.stringContaining('must start with'),
    );
  });

  it.each([
    'delete from users',
    'update users set x = 1',
    'insert into users values (1)',
    'drop table users',
    'truncate users',
    'alter table users add column x int',
    'grant select on users to bob',
  ])('rejects the write statement %s', (sql) => {
    expect(isReadOnlySql(sql)).toBe(false);
  });

  it('rejects data-modifying CTEs that would slip past the leading check', () => {
    expect(
      isReadOnlySql(
        'with gone as (delete from users returning id) select count(*) from gone',
      ),
    ).toBe(false);
  });

  it('rejects select ... into', () => {
    expect(isReadOnlySql('select * into copy_of_users from users')).toBe(false);
  });

  it('rejects empty or comment-only SQL', () => {
    expect(isReadOnlySql('   ')).toBe(false);
    expect(isReadOnlySql('-- nothing here')).toBe(false);
  });

  it('does not flag write keywords appearing inside identifiers or literals', () => {
    expect(isReadOnlySql('select deleted_at, updated_at from users')).toBe(
      true,
    );
    expect(
      isReadOnlySql(`select regexp_replace(name, 'a', 'b') from users`),
    ).toBe(true);
    expect(isReadOnlySql(`select 'drop table users' as note`)).toBe(true);
  });
});

describe('highestPlaceholder', () => {
  it('reports the highest referenced positional parameter', () => {
    expect(highestPlaceholder('select 1')).toBe(0);
    expect(highestPlaceholder('select * from t where ts >= $1')).toBe(1);
    expect(
      highestPlaceholder('select * from t where ts >= $1 and ts < $2'),
    ).toBe(2);
  });

  it('ignores placeholders inside literals', () => {
    expect(highestPlaceholder(`select '$1' as x`)).toBe(0);
  });
});

describe('stripTrailingSemicolon', () => {
  it('drops only the trailing semicolon', () => {
    expect(stripTrailingSemicolon('select 1;  ')).toBe('select 1');
    expect(stripTrailingSemicolon('select 1')).toBe('select 1');
  });
});
