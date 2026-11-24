BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Household] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [timezone] NVARCHAR(80) NOT NULL CONSTRAINT [Household_timezone_df] DEFAULT 'Pacific/Auckland',
    [location] NVARCHAR(120) NOT NULL CONSTRAINT [Household_location_df] DEFAULT '',
    [expiryWindowDays] INT NOT NULL CONSTRAINT [Household_expiryWindowDays_df] DEFAULT 7,
    [averageMonths] INT NOT NULL CONSTRAINT [Household_averageMonths_df] DEFAULT 3,
    [maxStores] INT NOT NULL CONSTRAINT [Household_maxStores_df] DEFAULT 2,
    [singleStore] BIT NOT NULL CONSTRAINT [Household_singleStore_df] DEFAULT 0,
    [reserveDefault] DECIMAL(18,2) NOT NULL CONSTRAINT [Household_reserveDefault_df] DEFAULT 0,
    [alertThreshold] DECIMAL(8,2),
    [preferences] NVARCHAR(max) NOT NULL CONSTRAINT [Household_preferences_df] DEFAULT '{}',
    [revision] INT NOT NULL CONSTRAINT [Household_revision_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Household_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BudgetMonth] (
    [id] NVARCHAR(36) NOT NULL,
    [householdId] NVARCHAR(36) NOT NULL,
    [month] NVARCHAR(7) NOT NULL,
    [funds] DECIMAL(18,2) NOT NULL,
    [reserve] DECIMAL(18,2) NOT NULL,
    [completed] BIT NOT NULL CONSTRAINT [BudgetMonth_completed_df] DEFAULT 0,
    [revision] INT NOT NULL CONSTRAINT [BudgetMonth_revision_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BudgetMonth_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BudgetMonth_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BudgetMonth_householdId_month_key] UNIQUE NONCLUSTERED ([householdId],[month])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseCommitment] (
    [id] NVARCHAR(36) NOT NULL,
    [budgetId] NVARCHAR(36) NOT NULL,
    [category] NVARCHAR(30) NOT NULL,
    [subcategory] NVARCHAR(60) NOT NULL CONSTRAINT [ExpenseCommitment_subcategory_df] DEFAULT '',
    [description] NVARCHAR(160) NOT NULL,
    [planned] DECIMAL(18,2) NOT NULL,
    [outstanding] DECIMAL(18,2) NOT NULL,
    [recurring] BIT NOT NULL CONSTRAINT [ExpenseCommitment_recurring_df] DEFAULT 1,
    [settlement] NVARCHAR(20) NOT NULL CONSTRAINT [ExpenseCommitment_settlement_df] DEFAULT 'unpaid',
    [revision] INT NOT NULL CONSTRAINT [ExpenseCommitment_revision_df] DEFAULT 1,
    CONSTRAINT [ExpenseCommitment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseTransaction] (
    [id] NVARCHAR(36) NOT NULL,
    [commitmentId] NVARCHAR(36) NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [incurredOn] NVARCHAR(10) NOT NULL,
    [note] NVARCHAR(500) NOT NULL CONSTRAINT [ExpenseTransaction_note_df] DEFAULT '',
    [revision] INT NOT NULL CONSTRAINT [ExpenseTransaction_revision_df] DEFAULT 1,
    CONSTRAINT [ExpenseTransaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryItem] (
    [id] NVARCHAR(36) NOT NULL,
    [householdId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [category] NVARCHAR(60) NOT NULL,
    [unit] NVARCHAR(10) NOT NULL,
    [minimum] DECIMAL(18,6) NOT NULL CONSTRAINT [InventoryItem_minimum_df] DEFAULT 0,
    [productId] NVARCHAR(36),
    [revision] INT NOT NULL CONSTRAINT [InventoryItem_revision_df] DEFAULT 1,
    CONSTRAINT [InventoryItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryBatch] (
    [id] NVARCHAR(36) NOT NULL,
    [itemId] NVARCHAR(36) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [acquiredOn] NVARCHAR(10) NOT NULL,
    [expiryDate] NVARCHAR(10),
    [dateLabel] NVARCHAR(20) NOT NULL CONSTRAINT [InventoryBatch_dateLabel_df] DEFAULT 'best-before',
    [purchaseLineId] NVARCHAR(36),
    [revision] INT NOT NULL CONSTRAINT [InventoryBatch_revision_df] DEFAULT 1,
    CONSTRAINT [InventoryBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryMovement] (
    [id] NVARCHAR(36) NOT NULL,
    [batchId] NVARCHAR(36) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [reason] NVARCHAR(160) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InventoryMovement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InventoryMovement_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ShoppingList] (
    [id] NVARCHAR(36) NOT NULL,
    [householdId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [ShoppingList_revision_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingList_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShoppingList_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ShoppingListItem] (
    [id] NVARCHAR(36) NOT NULL,
    [listId] NVARCHAR(36) NOT NULL,
    [inventoryItemId] NVARCHAR(36),
    [productId] NVARCHAR(36),
    [name] NVARCHAR(160) NOT NULL,
    [category] NVARCHAR(60) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [unit] NVARCHAR(10) NOT NULL,
    [priority] NVARCHAR(10) NOT NULL CONSTRAINT [ShoppingListItem_priority_df] DEFAULT 'normal',
    [origin] NVARCHAR(20) NOT NULL CONSTRAINT [ShoppingListItem_origin_df] DEFAULT 'manual',
    CONSTRAINT [ShoppingListItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Store] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [retailer] NVARCHAR(100) NOT NULL,
    [location] NVARCHAR(120) NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [Store_active_df] DEFAULT 1,
    CONSTRAINT [Store_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Product] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [normalisedName] NVARCHAR(160) NOT NULL,
    [category] NVARCHAR(60) NOT NULL,
    [brand] NVARCHAR(100) NOT NULL CONSTRAINT [Product_brand_df] DEFAULT '',
    [barcode] NVARCHAR(40),
    CONSTRAINT [Product_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataSource] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [type] NVARCHAR(30) NOT NULL,
    [permission] NVARCHAR(1000) NOT NULL,
    [freshnessDays] INT NOT NULL CONSTRAINT [DataSource_freshnessDays_df] DEFAULT 7,
    CONSTRAINT [DataSource_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataSource_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[StoreListing] (
    [id] NVARCHAR(36) NOT NULL,
    [storeId] NVARCHAR(36) NOT NULL,
    [productId] NVARCHAR(36) NOT NULL,
    [sku] NVARCHAR(80) NOT NULL,
    [packageQuantity] DECIMAL(18,6) NOT NULL,
    [unit] NVARCHAR(10) NOT NULL,
    CONSTRAINT [StoreListing_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StoreListing_storeId_sku_key] UNIQUE NONCLUSTERED ([storeId],[sku])
);

-- CreateTable
CREATE TABLE [dbo].[PriceSnapshot] (
    [id] NVARCHAR(36) NOT NULL,
    [listingId] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [observedAt] DATETIME2 NOT NULL,
    [importedAt] DATETIME2 NOT NULL CONSTRAINT [PriceSnapshot_importedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [price] DECIMAL(18,2) NOT NULL,
    [availability] NVARCHAR(20) NOT NULL,
    [promotion] NVARCHAR(200) NOT NULL CONSTRAINT [PriceSnapshot_promotion_df] DEFAULT '',
    CONSTRAINT [PriceSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PriceSnapshot_listingId_sourceId_observedAt_key] UNIQUE NONCLUSTERED ([listingId],[sourceId],[observedAt])
);

-- CreateTable
CREATE TABLE [dbo].[FulfilmentRule] (
    [id] NVARCHAR(36) NOT NULL,
    [storeId] NVARCHAR(36) NOT NULL,
    [mode] NVARCHAR(10) NOT NULL,
    [minimum] DECIMAL(18,2) NOT NULL,
    [delivery] DECIMAL(18,2),
    [freeThreshold] DECIMAL(18,2),
    [travel] DECIMAL(18,2) NOT NULL CONSTRAINT [FulfilmentRule_travel_df] DEFAULT 0,
    [source] NVARCHAR(300) NOT NULL,
    [observedAt] DATETIME2 NOT NULL CONSTRAINT [FulfilmentRule_observedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [revision] INT NOT NULL CONSTRAINT [FulfilmentRule_revision_df] DEFAULT 1,
    CONSTRAINT [FulfilmentRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FulfilmentRule_storeId_mode_key] UNIQUE NONCLUSTERED ([storeId],[mode])
);

-- CreateTable
CREATE TABLE [dbo].[SavedRecord] (
    [id] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(40) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [SavedRecord_revision_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SavedRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SavedRecord_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Purchase] (
    [id] NVARCHAR(36) NOT NULL,
    [budgetId] NVARCHAR(36) NOT NULL,
    [purchasedOn] NVARCHAR(10) NOT NULL,
    [storeName] NVARCHAR(120) NOT NULL CONSTRAINT [Purchase_storeName_df] DEFAULT '',
    [state] NVARCHAR(20) NOT NULL CONSTRAINT [Purchase_state_df] DEFAULT 'draft',
    [delivery] DECIMAL(18,2) NOT NULL CONSTRAINT [Purchase_delivery_df] DEFAULT 0,
    [travel] DECIMAL(18,2) NOT NULL CONSTRAINT [Purchase_travel_df] DEFAULT 0,
    [total] DECIMAL(18,2) NOT NULL CONSTRAINT [Purchase_total_df] DEFAULT 0,
    [sourcePlanId] NVARCHAR(80) NOT NULL,
    [confirmationKey] NVARCHAR(100) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [Purchase_revision_df] DEFAULT 1,
    CONSTRAINT [Purchase_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Purchase_sourcePlanId_key] UNIQUE NONCLUSTERED ([sourcePlanId]),
    CONSTRAINT [Purchase_confirmationKey_key] UNIQUE NONCLUSTERED ([confirmationKey])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseLine] (
    [id] NVARCHAR(36) NOT NULL,
    [purchaseId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [category] NVARCHAR(60) NOT NULL,
    [inventoryItemId] NVARCHAR(36),
    [productId] NVARCHAR(36),
    [quantity] DECIMAL(18,6) NOT NULL,
    [unit] NVARCHAR(10) NOT NULL,
    [lineCost] DECIMAL(18,2) NOT NULL,
    [expiryDate] NVARCHAR(10),
    CONSTRAINT [PurchaseLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseAdjustment] (
    [id] NVARCHAR(36) NOT NULL,
    [purchaseId] NVARCHAR(36) NOT NULL,
    [reason] NVARCHAR(500) NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PurchaseAdjustment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PurchaseAdjustment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SavedRecord_kind_createdAt_idx] ON [dbo].[SavedRecord]([kind], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[BudgetMonth] ADD CONSTRAINT [BudgetMonth_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCommitment] ADD CONSTRAINT [ExpenseCommitment_budgetId_fkey] FOREIGN KEY ([budgetId]) REFERENCES [dbo].[BudgetMonth]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseTransaction] ADD CONSTRAINT [ExpenseTransaction_commitmentId_fkey] FOREIGN KEY ([commitmentId]) REFERENCES [dbo].[ExpenseCommitment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryBatch] ADD CONSTRAINT [InventoryBatch_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryMovement] ADD CONSTRAINT [InventoryMovement_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[InventoryBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShoppingList] ADD CONSTRAINT [ShoppingList_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_listId_fkey] FOREIGN KEY ([listId]) REFERENCES [dbo].[ShoppingList]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StoreListing] ADD CONSTRAINT [StoreListing_storeId_fkey] FOREIGN KEY ([storeId]) REFERENCES [dbo].[Store]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StoreListing] ADD CONSTRAINT [StoreListing_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[Product]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PriceSnapshot] ADD CONSTRAINT [PriceSnapshot_listingId_fkey] FOREIGN KEY ([listingId]) REFERENCES [dbo].[StoreListing]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PriceSnapshot] ADD CONSTRAINT [PriceSnapshot_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[DataSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[FulfilmentRule] ADD CONSTRAINT [FulfilmentRule_storeId_fkey] FOREIGN KEY ([storeId]) REFERENCES [dbo].[Store]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Purchase] ADD CONSTRAINT [Purchase_budgetId_fkey] FOREIGN KEY ([budgetId]) REFERENCES [dbo].[BudgetMonth]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseLine] ADD CONSTRAINT [PurchaseLine_purchaseId_fkey] FOREIGN KEY ([purchaseId]) REFERENCES [dbo].[Purchase]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseAdjustment] ADD CONSTRAINT [PurchaseAdjustment_purchaseId_fkey] FOREIGN KEY ([purchaseId]) REFERENCES [dbo].[Purchase]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
