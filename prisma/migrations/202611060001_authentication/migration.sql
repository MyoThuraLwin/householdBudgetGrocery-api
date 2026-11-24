BEGIN TRY

BEGIN TRAN;

-- DropIndex
ALTER TABLE [dbo].[DataSource] DROP CONSTRAINT [DataSource_name_key];

-- AlterTable
ALTER TABLE [dbo].[ExpenseCommitment] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [ExpenseCommitment_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[ExpenseTransaction] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [ExpenseTransaction_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[InventoryBatch] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [InventoryBatch_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[InventoryMovement] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [InventoryMovement_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[ShoppingListItem] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [ShoppingListItem_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[Store] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [Store_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[Product] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [Product_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[DataSource] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [DataSource_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[StoreListing] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [StoreListing_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[PriceSnapshot] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [PriceSnapshot_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[FulfilmentRule] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [FulfilmentRule_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[SavedRecord] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [SavedRecord_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[Purchase] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [Purchase_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[PurchaseLine] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [PurchaseLine_householdId_df] DEFAULT '';

-- AlterTable
ALTER TABLE [dbo].[PurchaseAdjustment] ADD [householdId] NVARCHAR(36) NOT NULL CONSTRAINT [PurchaseAdjustment_householdId_df] DEFAULT '';

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(36) NOT NULL,
    [householdId] NVARCHAR(36) NOT NULL,
    [email] NVARCHAR(254) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [passwordHash] NVARCHAR(500) NOT NULL,
    [role] NVARCHAR(20) NOT NULL CONSTRAINT [User_role_df] DEFAULT 'household',
    [active] BIT NOT NULL CONSTRAINT [User_active_df] DEFAULT 1,
    [demo] BIT NOT NULL CONSTRAINT [User_demo_df] DEFAULT 0,
    [revision] INT NOT NULL CONSTRAINT [User_revision_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_householdId_key] UNIQUE NONCLUSTERED ([householdId]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[AuthSession] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [refreshHash] NVARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuthSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuthSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AuthSession_refreshHash_key] UNIQUE NONCLUSTERED ([refreshHash])
);

-- CreateTable
CREATE TABLE [dbo].[AdminAudit] (
    [id] NVARCHAR(36) NOT NULL,
    [actorId] NVARCHAR(36) NOT NULL,
    [targetId] NVARCHAR(36) NOT NULL,
    [action] NVARCHAR(80) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdminAudit_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AdminAudit_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuthSession_userId_idx] ON [dbo].[AuthSession]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BudgetMonth_householdId_idx] ON [dbo].[BudgetMonth]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseCommitment_householdId_idx] ON [dbo].[ExpenseCommitment]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseTransaction_householdId_idx] ON [dbo].[ExpenseTransaction]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryItem_householdId_idx] ON [dbo].[InventoryItem]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryBatch_householdId_idx] ON [dbo].[InventoryBatch]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryMovement_householdId_idx] ON [dbo].[InventoryMovement]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShoppingList_householdId_idx] ON [dbo].[ShoppingList]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShoppingListItem_householdId_idx] ON [dbo].[ShoppingListItem]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Store_householdId_idx] ON [dbo].[Store]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Product_householdId_idx] ON [dbo].[Product]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataSource_householdId_idx] ON [dbo].[DataSource]([householdId]);

-- CreateIndex
ALTER TABLE [dbo].[DataSource] ADD CONSTRAINT [DataSource_householdId_name_key] UNIQUE NONCLUSTERED ([householdId], [name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StoreListing_householdId_idx] ON [dbo].[StoreListing]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PriceSnapshot_householdId_idx] ON [dbo].[PriceSnapshot]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FulfilmentRule_householdId_idx] ON [dbo].[FulfilmentRule]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SavedRecord_householdId_idx] ON [dbo].[SavedRecord]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Purchase_householdId_idx] ON [dbo].[Purchase]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseLine_householdId_idx] ON [dbo].[PurchaseLine]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseAdjustment_householdId_idx] ON [dbo].[PurchaseAdjustment]([householdId]);

-- Preserve existing prototype ownership before adding tenant foreign keys.
DECLARE @legacyOwner NVARCHAR(36);
SELECT TOP (1) @legacyOwner = [id] FROM [dbo].[Household] ORDER BY [id];
EXEC sp_executesql N'UPDATE [dbo].[Store] SET [householdId] = @owner WHERE [householdId] = N'''';', N'@owner NVARCHAR(36)', @owner = @legacyOwner;
EXEC sp_executesql N'UPDATE [dbo].[Product] SET [householdId] = @owner WHERE [householdId] = N'''';', N'@owner NVARCHAR(36)', @owner = @legacyOwner;
EXEC sp_executesql N'UPDATE [dbo].[DataSource] SET [householdId] = @owner WHERE [householdId] = N'''';', N'@owner NVARCHAR(36)', @owner = @legacyOwner;
EXEC sp_executesql N'UPDATE [dbo].[SavedRecord] SET [householdId] = @owner WHERE [householdId] = N'''';', N'@owner NVARCHAR(36)', @owner = @legacyOwner;
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[ExpenseCommitment] c JOIN [dbo].[BudgetMonth] p ON c.[budgetId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[ExpenseTransaction] c JOIN [dbo].[ExpenseCommitment] p ON c.[commitmentId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[InventoryBatch] c JOIN [dbo].[InventoryItem] p ON c.[itemId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[InventoryMovement] c JOIN [dbo].[InventoryBatch] p ON c.[batchId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[ShoppingListItem] c JOIN [dbo].[ShoppingList] p ON c.[listId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[StoreListing] c JOIN [dbo].[Store] p ON c.[storeId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[PriceSnapshot] c JOIN [dbo].[StoreListing] p ON c.[listingId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[FulfilmentRule] c JOIN [dbo].[Store] p ON c.[storeId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[Purchase] c JOIN [dbo].[BudgetMonth] p ON c.[budgetId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[PurchaseLine] c JOIN [dbo].[Purchase] p ON c.[purchaseId] = p.[id];');
EXEC(N'UPDATE c SET c.[householdId] = p.[householdId] FROM [dbo].[PurchaseAdjustment] c JOIN [dbo].[Purchase] p ON c.[purchaseId] = p.[id];');

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCommitment] ADD CONSTRAINT [ExpenseCommitment_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseTransaction] ADD CONSTRAINT [ExpenseTransaction_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryBatch] ADD CONSTRAINT [InventoryBatch_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryMovement] ADD CONSTRAINT [InventoryMovement_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Store] ADD CONSTRAINT [Store_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Product] ADD CONSTRAINT [Product_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DataSource] ADD CONSTRAINT [DataSource_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StoreListing] ADD CONSTRAINT [StoreListing_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PriceSnapshot] ADD CONSTRAINT [PriceSnapshot_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[FulfilmentRule] ADD CONSTRAINT [FulfilmentRule_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedRecord] ADD CONSTRAINT [SavedRecord_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Purchase] ADD CONSTRAINT [Purchase_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseLine] ADD CONSTRAINT [PurchaseLine_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseAdjustment] ADD CONSTRAINT [PurchaseAdjustment_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuthSession] ADD CONSTRAINT [AuthSession_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
