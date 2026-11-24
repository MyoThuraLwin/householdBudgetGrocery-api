# Windows authentication adapter

`windows-adapter.mjs` adapts `@prisma/adapter-mssql` **7.10.1**, distributed under Apache-2.0 (see `LICENSE-prisma.txt`). The matching Prisma client, adapter, adapter utilities and CLI are pinned to that release.

The official adapter internally imports `mssql`'s default Tedious driver. This local adaptation imports `mssql/msnodesqlv8.js` instead, enabling current-user Windows authentication through `msnodesqlv8` and the installed Microsoft ODBC driver.

The only other changes are input parameter names and the corresponding SQL parameter references: `@P1` becomes `@HB1`, etc. ODBC uses its own `@P` names when preparing requests; without this rename, parameterised inserts fail with duplicate variable declarations.

There are no password fallbacks or global driver monkey patches. The application supplies an ODBC connection string with `Trusted_Connection=Yes`. The native driver must run under a Windows account with the appropriate database permissions. A local trusted-certificate setting is configurable for the development instance.

When upgrading Prisma, review upstream adapter changes and port these two adaptations deliberately. Run `npm run test:sql` to verify reads, parameterised inserts, decimals, dates, transactions, rollback and idempotent operations. Do not update the pinned packages independently.
