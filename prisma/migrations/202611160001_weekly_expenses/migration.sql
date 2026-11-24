BEGIN TRY
BEGIN TRAN;

ALTER TABLE [dbo].[ExpenseCommitment] ADD
    [frequency] NVARCHAR(10) NOT NULL CONSTRAINT [ExpenseCommitment_frequency_df] DEFAULT 'monthly',
    [inputAmount] DECIMAL(18,2) NULL;

-- Existing plans retain their exact monthly amounts and outstanding balances.
-- Compile checks after ALTER TABLE, so SQL Server can resolve the new columns.
EXEC(N'ALTER TABLE [dbo].[ExpenseCommitment] ADD CONSTRAINT [ExpenseCommitment_frequency_check]
    CHECK ([frequency] IN (''monthly'', ''weekly''));');
EXEC(N'ALTER TABLE [dbo].[ExpenseCommitment] ADD CONSTRAINT [ExpenseCommitment_inputAmount_check]
    CHECK (([inputAmount] IS NULL OR [inputAmount] >= 0)
        AND ([frequency] <> ''weekly'' OR ([inputAmount] IS NOT NULL AND [category] = ''accommodation'')));');

COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH
