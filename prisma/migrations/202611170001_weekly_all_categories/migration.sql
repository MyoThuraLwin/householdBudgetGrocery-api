BEGIN TRY
BEGIN TRAN;

-- Keep the original migration intact; broaden the weekly-input constraint.
ALTER TABLE [dbo].[ExpenseCommitment] DROP CONSTRAINT [ExpenseCommitment_inputAmount_check];
ALTER TABLE [dbo].[ExpenseCommitment] ADD CONSTRAINT [ExpenseCommitment_inputAmount_check]
    CHECK (([inputAmount] IS NULL OR [inputAmount] >= 0)
        AND ([frequency] <> 'weekly' OR [inputAmount] IS NOT NULL));

COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH
