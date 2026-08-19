-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('HQ', 'DEALER', 'MAKER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALES', 'ADMIN', 'MAKER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('role', 'user');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'confirmed', 'contracted', 'assigned', 'ordered', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('pending', 'done', 'na');

-- CreateEnum
CREATE TYPE "GeneratedDocType" AS ENUM ('load_calc', 'spec_table', 'work_order', 'contract');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNING', 'COMPLETED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "org" (
    "code" VARCHAR(30) NOT NULL,
    "type" "OrgType" NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "biz_no" VARCHAR(20),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "org_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user" (
    "email" VARCHAR(120) NOT NULL,
    "org_code" VARCHAR(30) NOT NULL,
    "role" "Role" NOT NULL,
    "extra_roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "name" VARCHAR(60) NOT NULL,
    "phone" VARCHAR(20),
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "must_change_pw" BOOLEAN NOT NULL DEFAULT true,
    "invited_by" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "password_hash" VARCHAR(80),
    "login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "is_master" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "feature_module" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "surface" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "feature_module_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "access_control" (
    "id" BIGSERIAL NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_ref" VARCHAR(120) NOT NULL,
    "module_code" VARCHAR(40) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,

    CONSTRAINT "access_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_model" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "drive_type" VARCHAR(10) NOT NULL,
    "seats_default" INTEGER NOT NULL,
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "wheelbase_mm" INTEGER,
    "tread_front_mm" INTEGER,
    "tread_rear_mm" INTEGER,
    "curb_weight_kg" INTEGER,
    "curb_axle_front_kg" INTEGER,
    "curb_axle_rear_kg" INTEGER,
    "gvw_limit_kg" INTEGER,
    "max_length_mm" INTEGER,
    "max_width_mm" INTEGER,
    "max_height_mm" INTEGER,
    "default_tire_front" VARCHAR(30),
    "default_tire_rear" VARCHAR(30),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehicle_model_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "option_group" (
    "code" VARCHAR(40) NOT NULL,
    "category" VARCHAR(40),
    "name" VARCHAR(60) NOT NULL,
    "select_type" VARCHAR(20) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "option_group_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "option_value" (
    "code" VARCHAR(40) NOT NULL,
    "group_code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "vivar_code" VARCHAR(40),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "option_value_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "option_group_model" (
    "group_code" VARCHAR(40) NOT NULL,
    "model_code" VARCHAR(30) NOT NULL,

    CONSTRAINT "option_group_model_pkey" PRIMARY KEY ("group_code","model_code")
);

-- CreateTable
CREATE TABLE "option_rule" (
    "code" VARCHAR(40) NOT NULL,
    "when_value" VARCHAR(40) NOT NULL,
    "effect" VARCHAR(20) NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_code" VARCHAR(40) NOT NULL,
    "memo" TEXT,

    CONSTRAINT "option_rule_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "option_price" (
    "model_code" VARCHAR(30) NOT NULL,
    "value_code" VARCHAR(40) NOT NULL,
    "supply_price" INTEGER NOT NULL,
    "memo" TEXT,

    CONSTRAINT "option_price_pkey" PRIMARY KEY ("model_code","value_code")
);

-- CreateTable
CREATE TABLE "door_unit_price" (
    "model_code" VARCHAR(30) NOT NULL,
    "top" VARCHAR(20) NOT NULL,
    "doortype" VARCHAR(20) NOT NULL,
    "unit_price" INTEGER NOT NULL,

    CONSTRAINT "door_unit_price_pkey" PRIMARY KEY ("model_code","top","doortype")
);

-- CreateTable
CREATE TABLE "region" (
    "name" VARCHAR(60) NOT NULL,
    "sido" VARCHAR(20) NOT NULL,
    "sigungu" VARCHAR(30) NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "subsidy_national" (
    "model_code" VARCHAR(30) NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "sosang_rate" DECIMAL(5,4),

    CONSTRAINT "subsidy_national_pkey" PRIMARY KEY ("model_code","year")
);

-- CreateTable
CREATE TABLE "subsidy_local" (
    "region" VARCHAR(60) NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "extra" INTEGER,
    "remaining_quota" INTEGER,
    "as_of" VARCHAR(20),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subsidy_local_pkey" PRIMARY KEY ("region","year")
);

-- CreateTable
CREATE TABLE "tax_config" (
    "param_key" VARCHAR(40) NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(20),
    "memo" TEXT,

    CONSTRAINT "tax_config_pkey" PRIMARY KEY ("param_key")
);

-- CreateTable
CREATE TABLE "quote_change_log" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "section" VARCHAR(20) NOT NULL,
    "field" VARCHAR(60) NOT NULL,
    "old_value" VARCHAR(300),
    "new_value" VARCHAR(300),
    "changed_by" VARCHAR(120) NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_no_counter" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_no_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "option_db_change_log" (
    "id" SERIAL NOT NULL,
    "table_name" VARCHAR(40) NOT NULL,
    "row_key" VARCHAR(160) NOT NULL,
    "field" VARCHAR(40) NOT NULL,
    "old_value" VARCHAR(200),
    "new_value" VARCHAR(200),
    "action" VARCHAR(10) NOT NULL,
    "changed_by" VARCHAR(120) NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "option_db_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_rate" (
    "months" INTEGER NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "label" VARCHAR(40),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "installment_rate_pkey" PRIMARY KEY ("months")
);

-- CreateTable
CREATE TABLE "weight_constant" (
    "key" VARCHAR(60) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,
    "unit" VARCHAR(20),
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_constant_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tire" (
    "spec" VARCHAR(40) NOT NULL,
    "allowable_load_kg" INTEGER NOT NULL,

    CONSTRAINT "tire_pkey" PRIMARY KEY ("spec")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "ceo_name" VARCHAR(60),
    "email" VARCHAR(120),
    "phone" VARCHAR(20),
    "tel" VARCHAR(20),
    "address" VARCHAR(120),
    "address_detail" VARCHAR(120),
    "reg_no" VARCHAR(20),
    "warp_customer_id" VARCHAR(40),
    "created_by" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden_at" TIMESTAMP(3),
    "hidden_by" VARCHAR(120),

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" SERIAL NOT NULL,
    "quote_no" VARCHAR(10),
    "customer_id" INTEGER,
    "model_code" VARCHAR(30) NOT NULL,
    "selections" JSONB NOT NULL DEFAULT '{}',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "supply_price" INTEGER,
    "final_price" INTEGER,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "source" VARCHAR(10) NOT NULL DEFAULT 'sales',
    "sales_user_id" VARCHAR(120),
    "org_id" VARCHAR(30),
    "sales_accepted_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "hidden_by" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "docs_emailed_at" TIMESTAMP(3),
    "docs_emailed_to" VARCHAR(200),
    "docs_frozen_at" TIMESTAMP(3),
    "docs_frozen_quote_path" VARCHAR(300),
    "docs_frozen_contract_path" VARCHAR(300),

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "maker_org_id" VARCHAR(30),
    "assigned_at" TIMESTAMP(3),
    "delivery_due" DATE,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicle_info" JSONB,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_step" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "track" VARCHAR(10) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "planned_at" DATE,
    "entered_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "done_by" VARCHAR(120),
    "note" VARCHAR(300),

    CONSTRAINT "order_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_file" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "step_code" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "original_name" VARCHAR(200),
    "mime" VARCHAR(60),
    "size_bytes" INTEGER,
    "kept_original" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" VARCHAR(120) NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_option" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "group_code" VARCHAR(40) NOT NULL,
    "value_code" VARCHAR(40) NOT NULL,

    CONSTRAINT "order_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_document" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "type" "GeneratedDocType" NOT NULL,
    "version" INTEGER NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_contract" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "modusign_document_id" VARCHAR(80),
    "signing_method" VARCHAR(10) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_snapshot" JSONB NOT NULL,
    "signed_pdf_path" VARCHAR(500),
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuning_application" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "modusign_document_id" VARCHAR(80),
    "signing_method" VARCHAR(10) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_snapshot" JSONB NOT NULL,
    "signed_pdf_path" VARCHAR(500),
    "downloaded_at" TIMESTAMP(3),
    "downloaded_by" VARCHAR(120),
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tuning_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modusign_webhook_event" (
    "id" SERIAL NOT NULL,
    "document_id" VARCHAR(80) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modusign_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_control_subject_type_subject_ref_module_code_key" ON "access_control"("subject_type", "subject_ref", "module_code");

-- CreateIndex
CREATE INDEX "quote_change_log_quote_id_changed_at_idx" ON "quote_change_log"("quote_id", "changed_at");

-- CreateIndex
CREATE INDEX "option_db_change_log_table_name_row_key_idx" ON "option_db_change_log"("table_name", "row_key");

-- CreateIndex
CREATE INDEX "option_db_change_log_changed_at_idx" ON "option_db_change_log"("changed_at");

-- CreateIndex
CREATE INDEX "customer_name_reg_no_idx" ON "customer"("name", "reg_no");

-- CreateIndex
CREATE UNIQUE INDEX "quote_quote_no_key" ON "quote"("quote_no");

-- CreateIndex
CREATE UNIQUE INDEX "order_quote_id_key" ON "order"("quote_id");

-- CreateIndex
CREATE INDEX "order_step_order_idx" ON "order_step"("order_id");

-- CreateIndex
CREATE INDEX "order_step_status_idx" ON "order_step"("status", "entered_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_step_unique" ON "order_step"("order_id", "code");

-- CreateIndex
CREATE INDEX "order_file_order_idx" ON "order_file"("order_id", "step_code");

-- CreateIndex
CREATE UNIQUE INDEX "order_option_order_id_group_code_key" ON "order_option"("order_id", "group_code");

-- CreateIndex
CREATE UNIQUE INDEX "generated_document_order_id_type_version_key" ON "generated_document"("order_id", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_contract_modusign_document_id_key" ON "purchase_contract"("modusign_document_id");

-- CreateIndex
CREATE INDEX "purchase_contract_quote_id_idx" ON "purchase_contract"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "tuning_application_modusign_document_id_key" ON "tuning_application"("modusign_document_id");

-- CreateIndex
CREATE INDEX "tuning_application_order_id_idx" ON "tuning_application"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "modusign_webhook_event_document_id_event_type_key" ON "modusign_webhook_event"("document_id", "event_type");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_org_code_fkey" FOREIGN KEY ("org_code") REFERENCES "org"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "user"("email") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_control" ADD CONSTRAINT "access_control_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "feature_module"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_value" ADD CONSTRAINT "option_value_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "option_group"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_group_model" ADD CONSTRAINT "option_group_model_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "option_group"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_group_model" ADD CONSTRAINT "option_group_model_model_code_fkey" FOREIGN KEY ("model_code") REFERENCES "vehicle_model"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_model_code_fkey" FOREIGN KEY ("model_code") REFERENCES "vehicle_model"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_value_code_fkey" FOREIGN KEY ("value_code") REFERENCES "option_value"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_unit_price" ADD CONSTRAINT "door_unit_price_model_code_fkey" FOREIGN KEY ("model_code") REFERENCES "vehicle_model"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsidy_national" ADD CONSTRAINT "subsidy_national_model_code_fkey" FOREIGN KEY ("model_code") REFERENCES "vehicle_model"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsidy_local" ADD CONSTRAINT "subsidy_local_region_fkey" FOREIGN KEY ("region") REFERENCES "region"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_change_log" ADD CONSTRAINT "quote_change_log_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("email") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_model_code_fkey" FOREIGN KEY ("model_code") REFERENCES "vehicle_model"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_sales_user_id_fkey" FOREIGN KEY ("sales_user_id") REFERENCES "user"("email") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_maker_org_id_fkey" FOREIGN KEY ("maker_org_id") REFERENCES "org"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_step" ADD CONSTRAINT "order_step_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_file" ADD CONSTRAINT "order_file_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_option" ADD CONSTRAINT "order_option_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_option" ADD CONSTRAINT "order_option_value_code_fkey" FOREIGN KEY ("value_code") REFERENCES "option_value"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_contract" ADD CONSTRAINT "purchase_contract_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_application" ADD CONSTRAINT "tuning_application_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
