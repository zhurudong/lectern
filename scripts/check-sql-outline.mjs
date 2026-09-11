// SQL 大纲回归：对象/查询可导航，且注释、字面量和嵌套语句不会污染顶层大纲。
// 与 check-extract.mjs 一样打包实际入口，覆盖 extractSymbols 的 SQL 路由。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { PROJECT } from './paths.mjs'

const work = mkdtempSync(join(tmpdir(), 'cv-sql-outline-'))
const out = join(work, 'extract.mjs')
let failed = 0
let total = 0

try {
  await build({
    entryPoints: [join(PROJECT, 'src/intel/extract.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'node',
    logLevel: 'error',
  })
  const { extractSymbols } = await import(pathToFileURL(out).href)

  const check = (name, run) => {
    total++
    try {
      run()
      console.log(`PASS  ${name}`)
    } catch (error) {
      failed++
      console.error(`FAIL  ${name}\n${error.message}`)
    }
  }

  // 标签需标明语句种类；展示文字允许保留或去掉标识符引号。
  const identifier = (name) => name.replace(/"([^"]|"")*"|`([^`]|``)*`|\[([^\]]|\]\])*\]/g, (part) => {
    const quote = part[0] === '[' ? ']' : part[0]
    return part.slice(1, -1).replaceAll(quote + quote, quote)
  })

  const expectOutline = (source, expected) => {
    const symbols = extractSymbols(source, 'sql')
    assert.equal(symbols.length, expected.length, `顶层条目不一致：${JSON.stringify(symbols)}`)
    for (let i = 0; i < expected.length; i++) {
      const actual = symbols[i]
      const wanted = expected[i]
      assert.equal(actual.kind, 16, `SQL 条目种类：${actual.name}`)
      assert.equal(actual.container, null, `顶层 SQL 不应有容器：${actual.name}`)
      assert.equal(actual.line, wanted.line, `跳转行号：${actual.name}`)
      assert.match(actual.name, wanted.type, `语句类型：${actual.name}`)
      if (wanted.target) {
        assert.ok(identifier(actual.name).includes(wanted.target), `条目 ${actual.name} 缺少目标 ${wanted.target}`)
      }
    }
  }

  check('DDL 对象定义齐全，AS 查询与 dollar-quoted 函数体不单独展开', () => {
    expectOutline([
      'CREATE TABLE IF NOT EXISTS public.users (id bigint PRIMARY KEY);',
      '',
      'CREATE OR REPLACE VIEW public.active_users AS',
      '  SELECT id FROM public.users WHERE id > 0;',
      'CREATE UNIQUE INDEX users_id_idx ON public.users (id);',
      'CREATE OR REPLACE FUNCTION public.user_count() RETURNS bigint',
      'LANGUAGE plpgsql AS $body$',
      'BEGIN',
      '  RETURN (SELECT count(*) FROM public.users);',
      'END;',
      '$body$;',
      'CREATE PROCEDURE public.refresh_users() LANGUAGE plpgsql AS $$',
      'BEGIN',
      '  DELETE FROM public.users;',
      '  INSERT INTO public.users VALUES (1);',
      'END;',
      '$$;',
    ].join('\n'), [
      { line: 1, type: /^TABLE\b/, target: 'public.users' },
      { line: 3, type: /^VIEW\b/, target: 'public.active_users' },
      { line: 5, type: /^INDEX\b/, target: 'users_id_idx' },
      { line: 6, type: /^FUNCTION\b/, target: 'public.user_count' },
      { line: 12, type: /^PROCEDURE\b/, target: 'public.refresh_users' },
    ])
  })

  check('大小写、多行和 CRLF 不影响限定对象名或语句起始行', () => {
    expectOutline([
      '-- generated schema',
      'cReAtE',
      '  TeMpOrArY TaBlE',
      '  "Sales"."Order Items" (id int);',
      'create view `reporting`.`daily orders` as',
      '  select * from "Sales"."Order Items";',
      'CREATE TABLE [dbo].[Order]]History] (id int);',
      'CREATE TABLE "Odd"."a""b" (id int);',
    ].join('\r\n'), [
      { line: 2, type: /^TABLE\b/, target: 'Sales.Order Items' },
      { line: 5, type: /^VIEW\b/, target: 'reporting.daily orders' },
      { line: 7, type: /^TABLE\b/, target: 'dbo.Order]History' },
      { line: 8, type: /^TABLE\b/, target: 'Odd.a"b' },
    ])
  })

  check('SELECT/INSERT/UPDATE/DELETE/MERGE 显示顶层目标并保留同一行的独立语句', () => {
    expectOutline([
      'SELECT id FROM users;',
      'INSERT INTO audit_log(id) SELECT id FROM users;',
      'UPDATE users SET id = 2 WHERE id = 1;',
      'DELETE FROM audit_log WHERE id = 2;',
      'MERGE INTO target_users AS t USING users AS s ON t.id = s.id',
      'WHEN MATCHED THEN UPDATE SET id = s.id;',
      'SELECT 1; SELECT 2;',
    ].join('\n'), [
      { line: 1, type: /^SELECT\b/, target: 'users' },
      { line: 2, type: /^INSERT\b/, target: 'audit_log' },
      { line: 3, type: /^UPDATE\b/, target: 'users' },
      { line: 4, type: /^DELETE\b/, target: 'audit_log' },
      { line: 5, type: /^MERGE\b/, target: 'target_users' },
      { line: 7, type: /^SELECT\b/ },
      { line: 7, type: /^SELECT\b/ },
    ])
  })

  check('CTE 只产生主语句条目，导航落在 WITH 而非内部 SELECT', () => {
    expectOutline([
      'WITH recent AS (',
      '  SELECT * FROM users WHERE id > 10',
      '), totals AS (SELECT count(*) AS n FROM recent)',
      'SELECT * FROM totals;',
      '',
      'WITH picked AS (SELECT id FROM users)',
      'INSERT INTO archive SELECT id FROM picked;',
      'WITH RECURSIVE walk(n) AS (',
      '  SELECT 1 UNION ALL SELECT n + 1 FROM walk WHERE n < 3',
      ') SELECT * FROM walk;',
    ].join('\n'), [
      { line: 1, type: /^SELECT\b/, target: 'totals' },
      { line: 6, type: /^INSERT\b/, target: 'archive' },
      { line: 8, type: /^SELECT\b/, target: 'walk' },
    ])
  })

  check('子查询、UNION 分支和 CREATE TABLE AS 不能扩成顶层语句', () => {
    expectOutline([
      'SELECT (SELECT count(*) FROM orders) AS total',
      'FROM users WHERE EXISTS (SELECT 1 FROM events)',
      'UNION ALL SELECT 0 FROM guests;',
      'CREATE TABLE archive AS',
      'SELECT * FROM (SELECT * FROM users) u;',
    ].join('\n'), [
      { line: 1, type: /^SELECT\b/, target: 'users' },
      { line: 4, type: /^TABLE\b/, target: 'archive' },
    ])
  })

  check('注释、单引号和 dollar quote 中的分号/DDL/DML 不产生条目', () => {
    expectOutline([
      '-- CREATE TABLE fake_comment(id int);',
      '/* SELECT * FROM fake_block;',
      '   /* INSERT INTO fake_nested VALUES (1); */',
      '   CREATE VIEW fake_view AS SELECT 1; */',
      "SELECT 'it''s a string; SELECT * FROM fake_string;' AS text;",
      'SELECT $tag$',
      'CREATE TABLE fake_dollar (id int);',
      'SELECT * FROM fake_dollar;',
      '$tag$ AS text;',
      '/* a comment before the actual statement */',
      'SELECT * FROM actual_users;',
    ].join('\n'), [
      { line: 5, type: /^SELECT\b/ },
      { line: 6, type: /^SELECT\b/ },
      { line: 11, type: /^SELECT\b/, target: 'actual_users' },
    ])
  })

  check('MySQL DELIMITER 将带嵌套 IF 的过程体保持为一个定义', () => {
    expectOutline([
      'DELIMITER $$',
      'CREATE PROCEDURE refresh_users()',
      'BEGIN',
      '  INSERT INTO audit_log VALUES (1);',
      '  IF 1 = 1 THEN',
      '    UPDATE users SET active = 1;',
      '  END IF;',
      '  SELECT * FROM users;',
      'END$$',
      'DELIMITER ;',
      'SELECT * FROM audit_log;',
    ].join('\n'), [
      { line: 2, type: /^PROCEDURE\b/, target: 'refresh_users' },
      { line: 11, type: /^SELECT\b/, target: 'audit_log' },
    ])
  })

  check('紧贴 END 的自定义分隔符结束过程，未重设分隔符的后续查询仍独立', () => {
    expectOutline([
      'DELIMITER $$',
      'CREATE PROCEDURE refresh_users()',
      'BEGIN',
      '  SELECT 1;',
      'END$$',
      'SELECT * FROM users$$',
      'SELECT * FROM audit_log$$',
    ].join('\n'), [
      { line: 2, type: /^PROCEDURE\b/, target: 'refresh_users' },
      { line: 6, type: /^SELECT\b/, target: 'users' },
      { line: 7, type: /^SELECT\b/, target: 'audit_log' },
    ])
  })

  check('普通 SQL 反斜杠不转义结束引号，E 字符串的转义引号仍保护内部伪语句', () => {
    expectOutline([
      String.raw`SELECT 'C:\';`,
      'SELECT * FROM path_check;',
      String.raw`SELECT E'it\'s; SELECT * FROM fake_escape;' AS label;`,
      'SELECT * FROM actual_users;',
    ].join('\n'), [
      { line: 1, type: /^SELECT\b/ },
      { line: 2, type: /^SELECT\b/, target: 'path_check' },
      { line: 3, type: /^SELECT\b/ },
      { line: 4, type: /^SELECT\b/, target: 'actual_users' },
    ])
  })

  check('psql 元命令前后 SQL 均保留，RECURSIVE VIEW 识别为视图定义', () => {
    expectOutline([
      'SELECT 1;',
      String.raw`\set schema public`,
      'CREATE RECURSIVE VIEW public.nums(n) AS',
      'VALUES (1) UNION ALL SELECT n + 1 FROM public.nums WHERE n < 3;',
      String.raw`\echo SELECT * FROM fake_meta;`,
      'SELECT * FROM public.nums',
      String.raw`\g`,
      String.raw`\d public.nums`,
      'SELECT * FROM audit_log;',
    ].join('\n'), [
      { line: 1, type: /^SELECT\b/ },
      { line: 3, type: /^VIEW\b/, target: 'public.nums' },
      { line: 6, type: /^SELECT\b/, target: 'public.nums' },
      { line: 9, type: /^SELECT\b/, target: 'audit_log' },
    ])
  })

  check('SQL Server GO 隔开过程批次，过程内分号不会泄漏 DML', () => {
    expectOutline([
      'CREATE OR ALTER PROCEDURE [dbo].[refresh_users] AS',
      'BEGIN',
      '  DELETE FROM [dbo].[audit_log];',
      '  SELECT * FROM [dbo].[users];',
      'END;',
      'GO',
      'SELECT * FROM [dbo].[audit_log]',
      'GO',
      'CREATE VIEW dbo.active_users AS SELECT * FROM dbo.users',
      'GO',
    ].join('\n'), [
      { line: 1, type: /^PROCEDURE\b/, target: 'dbo.refresh_users' },
      { line: 7, type: /^SELECT\b/, target: 'dbo.audit_log' },
      { line: 9, type: /^VIEW\b/, target: 'dbo.active_users' },
    ])
  })

  check('SQL Server 不带 BEGIN 的 AS 过程体直到 GO 仍属于同一定义', () => {
    expectOutline([
      'CREATE PROCEDURE dbo.refresh_users AS',
      'SELECT * FROM dbo.users;',
      'DELETE FROM dbo.audit_log;',
      'GO',
      'SELECT * FROM dbo.audit_log;',
    ].join('\n'), [
      { line: 1, type: /^PROCEDURE\b/, target: 'dbo.refresh_users' },
      { line: 5, type: /^SELECT\b/, target: 'dbo.audit_log' },
    ])
  })

  check('Oracle 过程声明段的分号不结束定义，斜杠之后恢复顶层查询', () => {
    expectOutline([
      'CREATE OR REPLACE PROCEDURE refresh_users AS',
      '  user_count NUMBER := 0;',
      'BEGIN',
      '  SELECT count(*) INTO user_count FROM users;',
      '  INSERT INTO audit_log VALUES (user_count);',
      'END;',
      '/',
      'SELECT * FROM audit_log;',
    ].join('\n'), [
      { line: 1, type: /^PROCEDURE\b/, target: 'refresh_users' },
      { line: 8, type: /^SELECT\b/, target: 'audit_log' },
    ])
  })

  check('物化视图和 ALTER/DROP/TRUNCATE 保留对象类型与目标', () => {
    expectOutline([
      'CREATE MATERIALIZED VIEW reporting.daily AS SELECT * FROM users;',
      'ALTER TABLE public.users ADD COLUMN active boolean;',
      'DROP VIEW IF EXISTS public.active_users;',
      'TRUNCATE TABLE public.audit_log;',
    ].join('\n'), [
      { line: 1, type: /^MATERIALIZED VIEW\b/, target: 'reporting.daily' },
      { line: 2, type: /^ALTER TABLE\b/, target: 'public.users' },
      { line: 3, type: /^DROP VIEW\b/, target: 'public.active_users' },
      { line: 4, type: /^TRUNCATE TABLE\b/, target: 'public.audit_log' },
    ])
  })

  check('空白、只有注释或分隔符的文件没有大纲', () => {
    for (const source of ['', ' \r\n\t', '-- SELECT 1;\n/* CREATE TABLE ghost(id int); */', ';\n;\nGO\n']) {
      assert.deepEqual(extractSymbols(source, 'sql'), [])
    }
  })

  check('编辑中的不完整 SQL 和未闭合字面量/注释不会崩溃', () => {
    const sources = [
      'CREATE', 'CREATE TABLE', 'SELECT', 'WITH', 'WITH x AS (SELECT',
      'CREATE TABLE "unfinished', "SELECT 'unfinished; SELECT ghost;",
      'SELECT $tag$unfinished; CREATE TABLE ghost(id int);',
      '/* unfinished; SELECT ghost;',
      'DELIMITER $$\nCREATE PROCEDURE unfinished() BEGIN SELECT 1;',
    ]
    const complete = 'WITH recent AS (SELECT id FROM users) SELECT * FROM recent;\nCREATE TABLE archive (id bigint);'
    for (let n = 1; n < complete.length; n++) sources.push(complete.slice(0, n))
    for (const source of sources) {
      const symbols = extractSymbols(source, 'sql')
      assert.ok(Array.isArray(symbols))
      const lines = source.split('\n').length
      for (const symbol of symbols) {
        assert.ok(Number.isInteger(symbol.line) && symbol.line >= 1 && symbol.line <= lines)
        assert.ok(typeof symbol.name === 'string' && symbol.name.length > 0)
        assert.equal(symbol.kind, 16)
      }
    }
  })

  console.log(`\n${total - failed}/${total} SQL outline checks passed`)
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(work, { recursive: true, force: true })
}
