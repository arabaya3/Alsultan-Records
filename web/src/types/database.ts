
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "album_categories": {
                  Row: {
                    "created_at": string,"id": string,"is_published": boolean,"slug": string,"sort_order": number,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_published"?: boolean,"slug": string,"sort_order"?: number,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_published"?: boolean,"slug"?: string,"sort_order"?: number,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"album_photos": {
                  Row: {
                    "album_id": string,"alt_text": string | null,"attempts": number,"bytes": number | null,"created_at": string,"deleted_at": string | null,"format": string | null,"height": number | null,"id": string,"is_published": boolean,"last_error": string | null,"mime": string,"processing_started_at": string | null,"sha256": string | null,"sort_order": number,"source_url": string | null,"storage_path_original": string,"updated_at": string,"upload_status": string,"variants": NonNullable<Json>,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "album_id": string,"alt_text"?: string | null,"attempts"?: number,"bytes"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"format"?: string | null,"height"?: number | null,"id"?: string,"is_published"?: boolean,"last_error"?: string | null,"mime": string,"processing_started_at"?: string | null,"sha256"?: string | null,"sort_order"?: number,"source_url"?: string | null,"storage_path_original": string,"updated_at"?: string,"upload_status"?: string,"variants"?: NonNullable<Json>,"width"?: number | null
                  }
                  Update: {
                    "album_id"?: string,"alt_text"?: string | null,"attempts"?: number,"bytes"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"format"?: string | null,"height"?: number | null,"id"?: string,"is_published"?: boolean,"last_error"?: string | null,"mime"?: string,"processing_started_at"?: string | null,"sha256"?: string | null,"sort_order"?: number,"source_url"?: string | null,"storage_path_original"?: string,"updated_at"?: string,"upload_status"?: string,"variants"?: NonNullable<Json>,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_photos_album_id_fkey"
      columns: ["album_id"]
isOneToOne: false
      referencedRelation: "photo_albums"
      referencedColumns: ["id"]
    }
                  ]
                },"album_selection_items": {
                  Row: {
                    "created_at": string,"id": string,"media_asset_id": string,"note": string | null,"selection_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"media_asset_id": string,"note"?: string | null,"selection_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"media_asset_id"?: string,"note"?: string | null,"selection_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_selection_items_media_asset_id_fkey"
      columns: ["media_asset_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "album_selection_items_selection_id_fkey"
      columns: ["selection_id"]
isOneToOne: false
      referencedRelation: "album_selections"
      referencedColumns: ["id"]
    }
                  ]
                },"album_selection_snapshots": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"item_count": number,"items": NonNullable<Json>,"selection_id": string,"submitted_at": string,"submitted_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"item_count": number,"items": NonNullable<Json>,"selection_id": string,"submitted_at"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"item_count"?: number,"items"?: NonNullable<Json>,"selection_id"?: string,"submitted_at"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_selection_snapshots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "album_selection_snapshots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "album_selection_snapshots_selection_id_fkey"
      columns: ["selection_id"]
isOneToOne: false
      referencedRelation: "album_selections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "album_selection_snapshots_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"album_selections": {
                  Row: {
                    "created_at": string,"customer_id": string,"event_id": string,"id": string,"status": Database["public"]['Enums']["selection_status"],"submitted_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"event_id": string,"id"?: string,"status"?: Database["public"]['Enums']["selection_status"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"event_id"?: string,"id"?: string,"status"?: Database["public"]['Enums']["selection_status"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_selections_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "album_selections_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "album_selections_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "album_selections_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "created_at": string,"dismissible": boolean,"ends_on": string | null,"id": string,"is_visible": boolean,"link_kind": string,"link_offer_id": string | null,"link_page": string | null,"sort_order": number,"starts_on": string | null,"template": string,"text": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dismissible"?: boolean,"ends_on"?: string | null,"id"?: string,"is_visible"?: boolean,"link_kind"?: string,"link_offer_id"?: string | null,"link_page"?: string | null,"sort_order"?: number,"starts_on"?: string | null,"template"?: string,"text": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"dismissible"?: boolean,"ends_on"?: string | null,"id"?: string,"is_visible"?: boolean,"link_kind"?: string,"link_offer_id"?: string | null,"link_page"?: string | null,"sort_order"?: number,"starts_on"?: string | null,"template"?: string,"text"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_link_offer_id_fkey"
      columns: ["link_offer_id"]
isOneToOne: false
      referencedRelation: "offers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcements_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "booking_rules": NonNullable<Json>,"created_at": string,"enabled_modules": (string)[],"id": number,"require_staff_mfa": boolean,"turnstile_enabled": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_rules"?: NonNullable<Json>,"created_at"?: string,"enabled_modules"?: (string)[],"id"?: number,"require_staff_mfa"?: boolean,"turnstile_enabled"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "booking_rules"?: NonNullable<Json>,"created_at"?: string,"enabled_modules"?: (string)[],"id"?: number,"require_staff_mfa"?: boolean,"turnstile_enabled"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor": string | null,"after": Json | null,"at": string,"before": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"backup_runs": {
                  Row: {
                    "created_at": string,"errors": Json | null,"finished_at": string | null,"id": string,"kind": string,"location": string | null,"object_counts": Json | null,"started_at": string,"status": Database["public"]['Enums']["backup_status"],"table_counts": Json | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"errors"?: Json | null,"finished_at"?: string | null,"id"?: string,"kind": string,"location"?: string | null,"object_counts"?: Json | null,"started_at"?: string,"status"?: Database["public"]['Enums']["backup_status"],"table_counts"?: Json | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"errors"?: Json | null,"finished_at"?: string | null,"id"?: string,"kind"?: string,"location"?: string | null,"object_counts"?: Json | null,"started_at"?: string,"status"?: Database["public"]['Enums']["backup_status"],"table_counts"?: Json | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"booking_requests": {
                  Row: {
                    "city": string | null,"contact_email": string | null,"contact_name": string,"contact_phone": string,"created_at": string,"customer_id": string | null,"event_date": string | null,"event_type": string,"guests": number | null,"id": string,"idempotency_key": string | null,"message": string | null,"services": (string)[],"source_ip_hash": string | null,"status": Database["public"]['Enums']["booking_status"],"tracking_code": string,"updated_at": string,"venue": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "city"?: string | null,"contact_email"?: string | null,"contact_name": string,"contact_phone": string,"created_at"?: string,"customer_id"?: string | null,"event_date"?: string | null,"event_type": string,"guests"?: number | null,"id"?: string,"idempotency_key"?: string | null,"message"?: string | null,"services"?: (string)[],"source_ip_hash"?: string | null,"status"?: Database["public"]['Enums']["booking_status"],"tracking_code"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Update: {
                    "city"?: string | null,"contact_email"?: string | null,"contact_name"?: string,"contact_phone"?: string,"created_at"?: string,"customer_id"?: string | null,"event_date"?: string | null,"event_type"?: string,"guests"?: number | null,"id"?: string,"idempotency_key"?: string | null,"message"?: string | null,"services"?: (string)[],"source_ip_hash"?: string | null,"status"?: Database["public"]['Enums']["booking_status"],"tracking_code"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_requests_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "booking_requests_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"booking_stage_history": {
                  Row: {
                    "booking_request_id": string,"changed_by": string | null,"created_at": string,"from_status": Database["public"]['Enums']["booking_status"] | null,"id": string,"note": string | null,"to_status": Database["public"]['Enums']["booking_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_request_id": string,"changed_by"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["booking_status"] | null,"id"?: string,"note"?: string | null,"to_status": Database["public"]['Enums']["booking_status"],"updated_at"?: string
                  }
                  Update: {
                    "booking_request_id"?: string,"changed_by"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["booking_status"] | null,"id"?: string,"note"?: string | null,"to_status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_stage_history_booking_request_id_fkey"
      columns: ["booking_request_id"]
isOneToOne: false
      referencedRelation: "booking_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "booking_stage_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"brand_assets": {
                  Row: {
                    "bytes": number | null,"created_at": string,"created_by": string | null,"height": number | null,"id": string,"kind": string,"mime": string,"note": string | null,"sha256": string | null,"storage_path": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"created_at"?: string,"created_by"?: string | null,"height"?: number | null,"id"?: string,"kind"?: string,"mime": string,"note"?: string | null,"sha256"?: string | null,"storage_path": string,"width"?: number | null
                  }
                  Update: {
                    "bytes"?: number | null,"created_at"?: string,"created_by"?: string | null,"height"?: number | null,"id"?: string,"kind"?: string,"mime"?: string,"note"?: string | null,"sha256"?: string | null,"storage_path"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "brand_assets_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"business_settings": {
                  Row: {
                    "active_logo_id": string | null,"address": string | null,"booking_message": string | null,"canonical_base_url": string | null,"created_at": string,"email": string | null,"facebook": string | null,"hero_cover_photo_id": string | null,"hero_media_id": string | null,"hero_primary_label": string | null,"hero_promo_source": string,"hero_promo_video_id": string | null,"hero_secondary_label": string | null,"hero_subtitle": string | null,"hero_title": string | null,"id": number,"instagram": string | null,"name": string,"phone": string | null,"tagline": string | null,"updated_at": string,"whatsapp": string | null,"whatsapp_url": string | null,"youtube_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active_logo_id"?: string | null,"address"?: string | null,"booking_message"?: string | null,"canonical_base_url"?: string | null,"created_at"?: string,"email"?: string | null,"facebook"?: string | null,"hero_cover_photo_id"?: string | null,"hero_media_id"?: string | null,"hero_primary_label"?: string | null,"hero_promo_source"?: string,"hero_promo_video_id"?: string | null,"hero_secondary_label"?: string | null,"hero_subtitle"?: string | null,"hero_title"?: string | null,"id"?: number,"instagram"?: string | null,"name"?: string,"phone"?: string | null,"tagline"?: string | null,"updated_at"?: string,"whatsapp"?: string | null,"whatsapp_url"?: string | null,"youtube_url"?: string | null
                  }
                  Update: {
                    "active_logo_id"?: string | null,"address"?: string | null,"booking_message"?: string | null,"canonical_base_url"?: string | null,"created_at"?: string,"email"?: string | null,"facebook"?: string | null,"hero_cover_photo_id"?: string | null,"hero_media_id"?: string | null,"hero_primary_label"?: string | null,"hero_promo_source"?: string,"hero_promo_video_id"?: string | null,"hero_secondary_label"?: string | null,"hero_subtitle"?: string | null,"hero_title"?: string | null,"id"?: number,"instagram"?: string | null,"name"?: string,"phone"?: string | null,"tagline"?: string | null,"updated_at"?: string,"whatsapp"?: string | null,"whatsapp_url"?: string | null,"youtube_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_settings_active_logo_id_fkey"
      columns: ["active_logo_id"]
isOneToOne: false
      referencedRelation: "brand_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_settings_hero_cover_photo_id_fkey"
      columns: ["hero_cover_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_settings_hero_fk"
      columns: ["hero_media_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_settings_hero_promo_video_id_fkey"
      columns: ["hero_promo_video_id"]
isOneToOne: false
      referencedRelation: "showcase_video_admin_details"
      referencedColumns: ["video_id"]
    },{
      foreignKeyName: "business_settings_hero_promo_video_id_fkey"
      columns: ["hero_promo_video_id"]
isOneToOne: false
      referencedRelation: "showcase_videos"
      referencedColumns: ["id"]
    }
                  ]
                },"contract_versions": {
                  Row: {
                    "body": string,"content_hash": string,"contract_id": string,"created_at": string,"created_by": string | null,"currency": string,"deposit_required": number,"id": string,"total": number,"updated_at": string,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"content_hash": string,"contract_id": string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deposit_required"?: number,"id"?: string,"total": number,"updated_at"?: string,"version_no": number
                  }
                  Update: {
                    "body"?: string,"content_hash"?: string,"contract_id"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deposit_required"?: number,"id"?: string,"total"?: number,"updated_at"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_versions_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contract_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"contracts": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"approved_version_id": string | null,"created_at": string,"current_version_id": string | null,"customer_id": string,"event_id": string | null,"id": string,"quote_id": string | null,"status": Database["public"]['Enums']["contract_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_version_id"?: string | null,"created_at"?: string,"current_version_id"?: string | null,"customer_id": string,"event_id"?: string | null,"id"?: string,"quote_id"?: string | null,"status"?: Database["public"]['Enums']["contract_status"],"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_version_id"?: string | null,"created_at"?: string,"current_version_id"?: string | null,"customer_id"?: string,"event_id"?: string | null,"id"?: string,"quote_id"?: string | null,"status"?: Database["public"]['Enums']["contract_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contracts_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_approved_version_fk"
      columns: ["approved_version_id"]
isOneToOne: false
      referencedRelation: "contract_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "contract_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "contracts_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "contracts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "city": string | null,"created_at": string,"created_by": string | null,"email": string | null,"full_name": string,"id": string,"notes": string | null,"phone": string | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "city"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name": string,"id"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "city"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name"?: string,"id"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"deliverable_revisions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deliverable_id": string,"id": string,"media_asset_id": string | null,"notes": string | null,"revision_no": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deliverable_id": string,"id"?: string,"media_asset_id"?: string | null,"notes"?: string | null,"revision_no": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deliverable_id"?: string,"id"?: string,"media_asset_id"?: string | null,"notes"?: string | null,"revision_no"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "deliverable_revisions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deliverable_revisions_deliverable_id_fkey"
      columns: ["deliverable_id"]
isOneToOne: false
      referencedRelation: "deliverables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deliverable_revisions_media_asset_id_fkey"
      columns: ["media_asset_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    }
                  ]
                },"deliverables": {
                  Row: {
                    "created_at": string,"due_at": string | null,"event_id": string,"id": string,"kind": Database["public"]['Enums']["deliverable_kind"],"status": Database["public"]['Enums']["deliverable_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"due_at"?: string | null,"event_id": string,"id"?: string,"kind": Database["public"]['Enums']["deliverable_kind"],"status"?: Database["public"]['Enums']["deliverable_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"due_at"?: string | null,"event_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["deliverable_kind"],"status"?: Database["public"]['Enums']["deliverable_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "deliverables_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "deliverables_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"equipment": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"serial": string | null,"status": Database["public"]['Enums']["equipment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"serial"?: string | null,"status"?: Database["public"]['Enums']["equipment_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"serial"?: string | null,"status"?: Database["public"]['Enums']["equipment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"equipment_assignments": {
                  Row: {
                    "created_at": string,"equipment_id": string,"event_id": string,"id": string,"out_at": string,"returned_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"equipment_id": string,"event_id": string,"id"?: string,"out_at": string,"returned_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"equipment_id"?: string,"event_id"?: string,"id"?: string,"out_at"?: string,"returned_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "equipment_assignments_equipment_id_fkey"
      columns: ["equipment_id"]
isOneToOne: false
      referencedRelation: "equipment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "equipment_assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "equipment_assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"equipment_maintenance": {
                  Row: {
                    "cost": number | null,"created_at": string,"description": string,"equipment_id": string,"finished_at": string | null,"id": string,"started_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost"?: number | null,"created_at"?: string,"description": string,"equipment_id": string,"finished_at"?: string | null,"id"?: string,"started_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cost"?: number | null,"created_at"?: string,"description"?: string,"equipment_id"?: string,"finished_at"?: string | null,"id"?: string,"started_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "equipment_maintenance_equipment_id_fkey"
      columns: ["equipment_id"]
isOneToOne: false
      referencedRelation: "equipment"
      referencedColumns: ["id"]
    }
                  ]
                },"event_staff_assignments": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"override_reason": string | null,"role_label": string | null,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"override_reason"?: string | null,"role_label"?: string | null,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"override_reason"?: string | null,"role_label"?: string | null,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_staff_assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "event_staff_assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_staff_assignments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff_members"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "booking_request_id": string | null,"city": string | null,"consent_at": string | null,"consent_by": string | null,"consent_revoked_by_customer_at": string | null,"coverage_notes": string | null,"created_at": string,"customer_id": string,"deleted_at": string | null,"deleted_by": string | null,"equipment_note": string | null,"event_date": string | null,"event_type": string | null,"featured": boolean,"featured_order": number | null,"highlight": string | null,"id": string,"is_published": boolean,"production_note": string | null,"public_slug": string | null,"publication_consent": Database["public"]['Enums']["consent_status"],"seo_description": string | null,"seo_title": string | null,"status": Database["public"]['Enums']["event_status"],"title": string,"updated_at": string,"venue": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_request_id"?: string | null,"city"?: string | null,"consent_at"?: string | null,"consent_by"?: string | null,"consent_revoked_by_customer_at"?: string | null,"coverage_notes"?: string | null,"created_at"?: string,"customer_id": string,"deleted_at"?: string | null,"deleted_by"?: string | null,"equipment_note"?: string | null,"event_date"?: string | null,"event_type"?: string | null,"featured"?: boolean,"featured_order"?: number | null,"highlight"?: string | null,"id"?: string,"is_published"?: boolean,"production_note"?: string | null,"public_slug"?: string | null,"publication_consent"?: Database["public"]['Enums']["consent_status"],"seo_description"?: string | null,"seo_title"?: string | null,"status"?: Database["public"]['Enums']["event_status"],"title": string,"updated_at"?: string,"venue"?: string | null
                  }
                  Update: {
                    "booking_request_id"?: string | null,"city"?: string | null,"consent_at"?: string | null,"consent_by"?: string | null,"consent_revoked_by_customer_at"?: string | null,"coverage_notes"?: string | null,"created_at"?: string,"customer_id"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"equipment_note"?: string | null,"event_date"?: string | null,"event_type"?: string | null,"featured"?: boolean,"featured_order"?: number | null,"highlight"?: string | null,"id"?: string,"is_published"?: boolean,"production_note"?: string | null,"public_slug"?: string | null,"publication_consent"?: Database["public"]['Enums']["consent_status"],"seo_description"?: string | null,"seo_title"?: string | null,"status"?: Database["public"]['Enums']["event_status"],"title"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_booking_request_id_fkey"
      columns: ["booking_request_id"]
isOneToOne: false
      referencedRelation: "booking_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_consent_by_fkey"
      columns: ["consent_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "events_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"category": string,"created_at": string,"currency": string,"event_id": string | null,"id": string,"note": string | null,"recorded_by": string | null,"spent_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"category": string,"created_at"?: string,"currency"?: string,"event_id"?: string | null,"id"?: string,"note"?: string | null,"recorded_by"?: string | null,"spent_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"category"?: string,"created_at"?: string,"currency"?: string,"event_id"?: string | null,"id"?: string,"note"?: string | null,"recorded_by"?: string | null,"spent_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "expenses_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"import_items": {
                  Row: {
                    "album_id": string | null,"bytes": number | null,"created_at": string,"error": string | null,"file_name": string | null,"id": string,"photo_id": string | null,"sha256": string | null,"source": string,"source_ref": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "album_id"?: string | null,"bytes"?: number | null,"created_at"?: string,"error"?: string | null,"file_name"?: string | null,"id"?: string,"photo_id"?: string | null,"sha256"?: string | null,"source": string,"source_ref": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "album_id"?: string | null,"bytes"?: number | null,"created_at"?: string,"error"?: string | null,"file_name"?: string | null,"id"?: string,"photo_id"?: string | null,"sha256"?: string | null,"source"?: string,"source_ref"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_items_album_id_fkey"
      columns: ["album_id"]
isOneToOne: false
      referencedRelation: "photo_albums"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_items_photo_id_fkey"
      columns: ["photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    }
                  ]
                },"media_assets": {
                  Row: {
                    "bucket": Database["public"]['Enums']["media_bucket"],"bytes": number | null,"created_at": string,"duration_s": number | null,"event_id": string | null,"height": number | null,"id": string,"kind": Database["public"]['Enums']["media_kind"],"mime": string,"path": string,"sort_order": number,"updated_at": string,"upload_status": Database["public"]['Enums']["upload_status"],"uploaded_by": string | null,"variants": NonNullable<Json>,"visibility": Database["public"]['Enums']["media_visibility"],"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": Database["public"]['Enums']["media_bucket"],"bytes"?: number | null,"created_at"?: string,"duration_s"?: number | null,"event_id"?: string | null,"height"?: number | null,"id"?: string,"kind": Database["public"]['Enums']["media_kind"],"mime": string,"path": string,"sort_order"?: number,"updated_at"?: string,"upload_status"?: Database["public"]['Enums']["upload_status"],"uploaded_by"?: string | null,"variants"?: NonNullable<Json>,"visibility"?: Database["public"]['Enums']["media_visibility"],"width"?: number | null
                  }
                  Update: {
                    "bucket"?: Database["public"]['Enums']["media_bucket"],"bytes"?: number | null,"created_at"?: string,"duration_s"?: number | null,"event_id"?: string | null,"height"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["media_kind"],"mime"?: string,"path"?: string,"sort_order"?: number,"updated_at"?: string,"upload_status"?: Database["public"]['Enums']["upload_status"],"uploaded_by"?: string | null,"variants"?: NonNullable<Json>,"visibility"?: Database["public"]['Enums']["media_visibility"],"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_assets_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "media_assets_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_assets_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"nav_items": {
                  Row: {
                    "id": string,"is_visible": boolean,"label": string,"sort_order": number,"target": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_visible"?: boolean,"label": string,"sort_order"?: number,"target": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "id"?: string,"is_visible"?: boolean,"label"?: string,"sort_order"?: number,"target"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "nav_items_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"payload": NonNullable<Json>,"read_at": string | null,"recipient_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"recipient_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"recipient_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"offer_items": {
                  Row: {
                    "created_at": string,"id": string,"label": string,"offer_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"label": string,"offer_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"label"?: string,"offer_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "offer_items_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: false
      referencedRelation: "offers"
      referencedColumns: ["id"]
    }
                  ]
                },"offers": {
                  Row: {
                    "created_at": string,"currency": string,"description": string | null,"display_price_minor": number | null,"ends_on": string | null,"id": string,"image_photo_id": string | null,"package_id": string | null,"pinned_home": boolean,"price_minor": number | null,"show_price": boolean,"slug": string,"sort_order": number,"starts_on": string | null,"status": string,"target_month": number | null,"target_year": number | null,"terms": string | null,"title": string,"updated_at": string,"updated_by": string | null,"whatsapp_message": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency"?: string,"description"?: string | null,"display_price_minor"?: never,"ends_on"?: string | null,"id"?: string,"image_photo_id"?: string | null,"package_id"?: string | null,"pinned_home"?: boolean,"price_minor"?: number | null,"show_price"?: boolean,"slug": string,"sort_order"?: number,"starts_on"?: string | null,"status"?: string,"target_month"?: number | null,"target_year"?: number | null,"terms"?: string | null,"title": string,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_message"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"description"?: string | null,"display_price_minor"?: never,"ends_on"?: string | null,"id"?: string,"image_photo_id"?: string | null,"package_id"?: string | null,"pinned_home"?: boolean,"price_minor"?: number | null,"show_price"?: boolean,"slug"?: string,"sort_order"?: number,"starts_on"?: string | null,"status"?: string,"target_month"?: number | null,"target_year"?: number | null,"terms"?: string | null,"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_message"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "offers_image_photo_id_fkey"
      columns: ["image_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_package_id_fkey"
      columns: ["package_id"]
isOneToOne: false
      referencedRelation: "packages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"package_items": {
                  Row: {
                    "created_at": string,"id": string,"label": string,"package_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"label": string,"package_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"label"?: string,"package_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_items_package_id_fkey"
      columns: ["package_id"]
isOneToOne: false
      referencedRelation: "packages"
      referencedColumns: ["id"]
    }
                  ]
                },"packages": {
                  Row: {
                    "created_at": string,"currency": string,"description": string | null,"display_price_minor": number | null,"featured": boolean,"gift": string | null,"group_label": string | null,"id": string,"image_photo_id": string | null,"internal_note": string | null,"price_minor": number | null,"show_price": boolean,"slug": string,"sort_order": number,"status": string,"title": string,"updated_at": string,"updated_by": string | null,"whatsapp_message": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency"?: string,"description"?: string | null,"display_price_minor"?: never,"featured"?: boolean,"gift"?: string | null,"group_label"?: string | null,"id"?: string,"image_photo_id"?: string | null,"internal_note"?: string | null,"price_minor"?: number | null,"show_price"?: boolean,"slug": string,"sort_order"?: number,"status"?: string,"title": string,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_message"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"description"?: string | null,"display_price_minor"?: never,"featured"?: boolean,"gift"?: string | null,"group_label"?: string | null,"id"?: string,"image_photo_id"?: string | null,"internal_note"?: string | null,"price_minor"?: number | null,"show_price"?: boolean,"slug"?: string,"sort_order"?: number,"status"?: string,"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_message"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "packages_image_photo_id_fkey"
      columns: ["image_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packages_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"contract_id": string | null,"created_at": string,"currency": string,"customer_id": string,"event_id": string | null,"id": string,"idempotency_key": string,"kind": Database["public"]['Enums']["payment_kind"],"method": string,"received_at": string,"recorded_by": string | null,"reference": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"contract_id"?: string | null,"created_at"?: string,"currency"?: string,"customer_id": string,"event_id"?: string | null,"id"?: string,"idempotency_key": string,"kind"?: Database["public"]['Enums']["payment_kind"],"method": string,"received_at"?: string,"recorded_by"?: string | null,"reference"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"contract_id"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"event_id"?: string | null,"id"?: string,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["payment_kind"],"method"?: string,"received_at"?: string,"recorded_by"?: string | null,"reference"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "payments_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "payments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"photo_albums": {
                  Row: {
                    "archived_at": string | null,"category_id": string | null,"cover_photo_id": string | null,"created_at": string,"deleted_at": string | null,"description": string | null,"event_date": string | null,"id": string,"is_published": boolean,"rights_note": string | null,"slug": string,"sort_order": number,"source_label": string | null,"source_url": string | null,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"category_id"?: string | null,"cover_photo_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"event_date"?: string | null,"id"?: string,"is_published"?: boolean,"rights_note"?: string | null,"slug": string,"sort_order"?: number,"source_label"?: string | null,"source_url"?: string | null,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"category_id"?: string | null,"cover_photo_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"event_date"?: string | null,"id"?: string,"is_published"?: boolean,"rights_note"?: string | null,"slug"?: string,"sort_order"?: number,"source_label"?: string | null,"source_url"?: string | null,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "photo_albums_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "album_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photo_albums_cover_fk"
      columns: ["cover_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photo_albums_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"process_steps": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_published": boolean,"photo_id": string | null,"sort_order": number,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_published"?: boolean,"photo_id"?: string | null,"sort_order"?: number,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_published"?: boolean,"photo_id"?: string | null,"sort_order"?: number,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "process_steps_photo_id_fkey"
      columns: ["photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "process_steps_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"disabled": boolean,"full_name": string | null,"id": string,"mfa_required": boolean,"phone": string | null,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"disabled"?: boolean,"full_name"?: string | null,"id": string,"mfa_required"?: boolean,"phone"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"disabled"?: boolean,"full_name"?: string | null,"id"?: string,"mfa_required"?: boolean,"phone"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quote_items": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"line_total": number,"qty": number,"quote_id": string,"sort_order": number,"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: string,"line_total"?: number,"qty"?: number,"quote_id": string,"sort_order"?: number,"unit_price": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"line_total"?: number,"qty"?: number,"quote_id"?: string,"sort_order"?: number,"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"currency": string,"customer_id": string,"discount": number,"event_id": string | null,"id": string,"quote_no": string,"status": Database["public"]['Enums']["quote_status"],"subtotal": number,"total": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"currency"?: string,"customer_id": string,"discount"?: number,"event_id"?: string | null,"id"?: string,"quote_no"?: string,"status"?: Database["public"]['Enums']["quote_status"],"subtotal"?: number,"total"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"discount"?: number,"event_id"?: string | null,"id"?: string,"quote_no"?: string,"status"?: Database["public"]['Enums']["quote_status"],"subtotal"?: number,"total"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "quotes_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "quotes_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "body": string,"created_at": string,"customer_id": string,"display_name": string | null,"event_id": string | null,"id": string,"moderated_at": string | null,"moderated_by": string | null,"rating": number,"status": Database["public"]['Enums']["review_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"customer_id": string,"display_name"?: string | null,"event_id"?: string | null,"id"?: string,"moderated_at"?: string | null,"moderated_by"?: string | null,"rating": number,"status"?: Database["public"]['Enums']["review_status"],"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"customer_id"?: string,"display_name"?: string | null,"event_id"?: string | null,"id"?: string,"moderated_at"?: string | null,"moderated_by"?: string | null,"rating"?: number,"status"?: Database["public"]['Enums']["review_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "reviews_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_internal_notes"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "reviews_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_moderated_by_fkey"
      columns: ["moderated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"service_categories": {
                  Row: {
                    "created_at": string,"id": string,"slug": string,"sort_order": number,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"slug": string,"sort_order"?: number,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"slug"?: string,"sort_order"?: number,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"service_links": {
                  Row: {
                    "created_at": string,"kind": string,"service_id": string,"sort_order": number,"target_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"kind": string,"service_id": string,"sort_order"?: number,"target_id": string
                  }
                  Update: {
                    "created_at"?: string,"kind"?: string,"service_id"?: string,"sort_order"?: number,"target_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_links_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"services": {
                  Row: {
                    "body": string | null,"category_id": string | null,"cover_media_id": string | null,"cover_photo_id": string | null,"created_at": string,"id": string,"is_published": boolean,"slug": string,"sort_order": number,"summary": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"category_id"?: string | null,"cover_media_id"?: string | null,"cover_photo_id"?: string | null,"created_at"?: string,"id"?: string,"is_published"?: boolean,"slug": string,"sort_order"?: number,"summary"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string | null,"category_id"?: string | null,"cover_media_id"?: string | null,"cover_photo_id"?: string | null,"created_at"?: string,"id"?: string,"is_published"?: boolean,"slug"?: string,"sort_order"?: number,"summary"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "service_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "services_cover_fk"
      columns: ["cover_media_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "services_cover_photo_id_fkey"
      columns: ["cover_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    }
                  ]
                },"showcase_video_categories": {
                  Row: {
                    "category_id": string,"created_at": string,"is_primary": boolean,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"is_primary"?: boolean,"video_id": string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"is_primary"?: boolean,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "showcase_video_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "video_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "showcase_video_categories_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "showcase_video_admin_details"
      referencedColumns: ["video_id"]
    },{
      foreignKeyName: "showcase_video_categories_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "showcase_videos"
      referencedColumns: ["id"]
    }
                  ]
                },"showcase_videos": {
                  Row: {
                    "category": string,"created_at": string,"custom_cover_photo_id": string | null,"description": string | null,"duration_seconds": number | null,"id": string,"is_promo": boolean,"is_published": boolean,"needs_review": boolean,"original_title": string | null,"pinned": boolean,"published_at": string | null,"review_note": string | null,"reviewed_at": string | null,"role": string,"sort_order": number,"source": string,"source_url": string,"title": string,"title_source": string,"updated_at": string,"updated_by": string | null,"verification_notes": string | null,"youtube_description": string | null,"youtube_id": string,"youtube_title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"created_at"?: string,"custom_cover_photo_id"?: string | null,"description"?: string | null,"duration_seconds"?: number | null,"id"?: string,"is_promo"?: boolean,"is_published"?: boolean,"needs_review"?: boolean,"original_title"?: string | null,"pinned"?: boolean,"published_at"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"role"?: string,"sort_order"?: number,"source"?: string,"source_url": string,"title": string,"title_source"?: string,"updated_at"?: string,"updated_by"?: string | null,"verification_notes"?: string | null,"youtube_description"?: string | null,"youtube_id": string,"youtube_title"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"custom_cover_photo_id"?: string | null,"description"?: string | null,"duration_seconds"?: number | null,"id"?: string,"is_promo"?: boolean,"is_published"?: boolean,"needs_review"?: boolean,"original_title"?: string | null,"pinned"?: boolean,"published_at"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"role"?: string,"sort_order"?: number,"source"?: string,"source_url"?: string,"title"?: string,"title_source"?: string,"updated_at"?: string,"updated_by"?: string | null,"verification_notes"?: string | null,"youtube_description"?: string | null,"youtube_id"?: string,"youtube_title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "showcase_videos_custom_cover_photo_id_fkey"
      columns: ["custom_cover_photo_id"]
isOneToOne: false
      referencedRelation: "album_photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "showcase_videos_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"site_sections": {
                  Row: {
                    "featured_ids": (string)[],"intro": string | null,"is_visible": boolean,"item_limit": number,"key": string,"sort_order": number,"stat_value": number | null,"title": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "featured_ids"?: (string)[],"intro"?: string | null,"is_visible"?: boolean,"item_limit"?: number,"key": string,"sort_order"?: number,"stat_value"?: number | null,"title"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "featured_ids"?: (string)[],"intro"?: string | null,"is_visible"?: boolean,"item_limit"?: number,"key"?: string,"sort_order"?: number,"stat_value"?: number | null,"title"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_sections_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"slug_redirects": {
                  Row: {
                    "created_at": string,"from_path": string,"to_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"from_path": string,"to_path": string
                  }
                  Update: {
                    "created_at"?: string,"from_path"?: string,"to_path"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff_members": {
                  Row: {
                    "active": boolean,"created_at": string,"full_name": string,"id": string,"phone": string | null,"profile_id": string | null,"specialty": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"full_name": string,"id"?: string,"phone"?: string | null,"profile_id"?: string | null,"specialty"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"full_name"?: string,"id"?: string,"phone"?: string | null,"profile_id"?: string | null,"specialty"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_members_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"support_messages": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": string,"is_staff_reply": boolean,"request_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"is_staff_reply"?: boolean,"request_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"is_staff_reply"?: boolean,"request_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "support_messages_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "support_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"support_requests": {
                  Row: {
                    "contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"customer_id": string | null,"id": string,"idempotency_key": string | null,"source_ip_hash": string | null,"status": Database["public"]['Enums']["support_status"],"subject": string,"tracking_code": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"customer_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"source_ip_hash"?: string | null,"status"?: Database["public"]['Enums']["support_status"],"subject": string,"tracking_code"?: string,"updated_at"?: string
                  }
                  Update: {
                    "contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"customer_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"source_ip_hash"?: string | null,"status"?: Database["public"]['Enums']["support_status"],"subject"?: string,"tracking_code"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_requests_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer_internal_notes"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "support_requests_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"video_categories": {
                  Row: {
                    "created_at": string,"id": string,"is_published": boolean,"slug": string,"sort_order": number,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_published"?: boolean,"slug": string,"sort_order"?: number,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_published"?: boolean,"slug"?: string,"sort_order"?: number,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"video_comments": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": string,"resolved": boolean,"revision_id": string,"timecode_ms": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"resolved"?: boolean,"revision_id": string,"timecode_ms": number,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"resolved"?: boolean,"revision_id"?: string,"timecode_ms"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "video_comments_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: false
      referencedRelation: "deliverable_revisions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "customer_internal_notes": {
                  Row: {
                    "customer_id": string | null,"notes": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "customer_id"?: string | null,"notes"?: string | null
                         }
                        Update: {
                           "customer_id"?: string | null,"notes"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"event_internal_notes": {
                  Row: {
                    "equipment_note": string | null,"event_id": string | null,"production_note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "equipment_note"?: string | null,"event_id"?: string | null,"production_note"?: string | null
                         }
                        Update: {
                           "equipment_note"?: string | null,"event_id"?: string | null,"production_note"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"showcase_video_admin_details": {
                  Row: {
                    "needs_review": boolean | null,"original_title": string | null,"review_note": string | null,"reviewed_at": string | null,"source": string | null,"source_url": string | null,"title_source": string | null,"updated_by": string | null,"verification_notes": string | null,"video_id": string | null,"youtube_description": string | null,"youtube_title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "needs_review"?: boolean | null,"original_title"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"source"?: string | null,"source_url"?: string | null,"title_source"?: string | null,"updated_by"?: string | null,"verification_notes"?: string | null,"video_id"?: string | null,"youtube_description"?: string | null,"youtube_title"?: string | null
                         }
                        Update: {
                           "needs_review"?: boolean | null,"original_title"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"source"?: string | null,"source_url"?: string | null,"title_source"?: string | null,"updated_by"?: string | null,"verification_notes"?: string | null,"video_id"?: string | null,"youtube_description"?: string | null,"youtube_title"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "showcase_videos_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "active_logo_path":
{ Args: { "p_id": string }; Returns: string
                           },
"admin_enabled_modules":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"admin_event_prices":
{ Args: { "p_ids": (string)[] }; Returns: {
              "amount": number,"basis": string,"currency": string,"event_id": string
            }[]
                           },
"admin_financial_summary":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "contracted": number,"currency": string,"expenses": number,"net_cash": number,"outstanding": number,"paid": number,"refunded": number
            }[]
                           },
"admin_link_customer_user":
{ Args: { "p_customer_id": string,"p_user_id": string }; Returns: undefined
                           },
"admin_revoke_user_sessions":
{ Args: { "p_user_id": string }; Returns: number
                           },
"admin_set_user_disabled":
{ Args: { "p_disabled": boolean,"p_user_id": string }; Returns: undefined
                           },
"admin_set_user_role":
{ Args: { "p_role": Database["public"]['Enums']["app_role"],"p_user_id": string }; Returns: undefined
                           },
"album_photo_object_ref":
{ Args: { "p_photo_id": string,"p_variant": string }; Returns: { provider: string; path: string }[]
                           },
"album_photo_object_path":
{ Args: { "p_photo_id": string,"p_variant": string }; Returns: string
                           },
"album_upload_complete":
{ Args: { "p_photo_id": string }; Returns: boolean
                           },
"album_upload_reopen":
{ Args: { "p_bytes": number,"p_photo_id": string }; Returns: boolean
                           },
"bootstrap_initial_owner":
{ Args: { "p_token": string }; Returns: undefined
                           },
"claim_photo_jobs":
{ Args: { "p_limit"?: number }; Returns: {
              "album_id": string,"attempts": number,"id": string,"mime": string,"storage_path_original": string
            }[]
                           },
"claim_storage_cleanup":
{ Args: { "p_limit"?: number }; Returns: {
              "bucket": string,"enqueued_at": string,"id": string,"path": string,"reason": string
            }[]
                           },
"complete_photo_job":
{ Args: { "p_error"?: string,"p_height"?: number,"p_id": string,"p_ok": boolean,"p_variants"?: Json,"p_width"?: number }; Returns: boolean
                           },
"complete_storage_cleanup":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"customer_accept_quote":
{ Args: { "p_quote_id": string }; Returns: undefined
                           },
"customer_approve_contract":
{ Args: { "p_content_hash": string,"p_version_id": string }; Returns: undefined
                           },
"customer_request_revision":
{ Args: { "p_deliverable_id": string,"p_note": string }; Returns: undefined
                           },
"event_financials":
{ Args: { "p_event_id": string }; Returns: {
              "balance": number,"balance_basis": string,"contracted": number,"currency": string,"event_id": string,"expenses": number,"paid": number,"quoted": number,"refunded": number
            }[]
                           },
"fail_storage_cleanup":
{ Args: { "p_error": string,"p_ids": (string)[] }; Returns: number
                           },
"find_duplicate_photo":
{ Args: { "p_sha256": string }; Returns: {
              "album_id": string,"album_title": string,"photo_id": string
            }[]
                           },
"public_submit_booking":
{ Args: { "p_city"?: string,"p_contact_email"?: string,"p_contact_name": string,"p_contact_phone": string,"p_customer_id"?: string,"p_event_date"?: string,"p_event_type": string,"p_guests"?: number,"p_idempotency_key": string,"p_ip_hash": string,"p_message"?: string,"p_services"?: (string)[],"p_venue"?: string }; Returns: string
                           },
"public_submit_support":
{ Args: { "p_contact_email"?: string,"p_contact_name": string,"p_contact_phone": string,"p_idempotency_key": string,"p_ip_hash": string,"p_message": string,"p_subject": string }; Returns: string
                           },
"public_track_booking":
{ Args: { "p_ip_hash": string,"p_phone_last4": string,"p_tracking_code": string }; Returns: {
              "event_date": string,"status": Database["public"]['Enums']["booking_status"],"updated_at": string
            }[]
                           },
"public_track_support":
{ Args: { "p_ip_hash": string,"p_phone_last4": string,"p_tracking_code": string }; Returns: {
              "status": Database["public"]['Enums']["support_status"],"updated_at": string
            }[]
                           },
"purge_album":
{ Args: { "p_confirm_slug": string,"p_id": string }; Returns: number
                           },
"purge_test_fixtures":
{ Args: { "p_prefix": string }; Returns: Json
                           },
"record_payment":
{ Args: { "p_amount": number,"p_contract_id"?: string,"p_currency"?: string,"p_customer_id": string,"p_event_id"?: string,"p_idempotency_key": string,"p_kind"?: Database["public"]['Enums']["payment_kind"],"p_method": string,"p_received_at"?: string,"p_reference"?: string }; Returns: string
                           },
"requeue_album_photos":
{ Args: { "p_album_id": string,"p_photo_id"?: string }; Returns: number
                           },
"restore_event":
{ Args: { "p_id": string }; Returns: undefined
                           },
"set_event_publication":
{ Args: { "p_event_id": string,"p_featured"?: boolean,"p_featured_order"?: number,"p_publish": boolean }; Returns: undefined
                           },
"set_publication_consent":
{ Args: { "p_event_id": string,"p_status": Database["public"]['Enums']["consent_status"] }; Returns: undefined
                           },
"set_showcase_promo":
{ Args: { "p_id": string }; Returns: undefined
                           },
"staff_mfa_required":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"storage_cleanup_pending":
{ Args: Record<PropertyKey, never>; Returns: {
              "dead": number,"failing": number,"pending": number
            }[]
                           },
"submit_album_selection":
{ Args: { "p_event_id": string }; Returns: string
                           },
"transition_booking":
{ Args: { "p_booking_id": string,"p_note"?: string,"p_to": Database["public"]['Enums']["booking_status"] }; Returns: undefined
                           },
"trash_event":
{ Args: { "p_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_role": "owner"|"admin"|"staff"|"customer","backup_status": "running"|"completed"|"partial"|"failed","booking_status": "new"|"contacted"|"quoted"|"confirmed"|"cancelled"|"declined","consent_status": "none"|"requested"|"granted"|"revoked","contract_status": "draft"|"sent"|"approved"|"void","deliverable_kind": "gallery"|"video"|"album"|"files","deliverable_status": "in_progress"|"review"|"revision_requested"|"approved"|"delivered","equipment_status": "available"|"assigned"|"maintenance"|"retired","event_status": "planned"|"shooting"|"editing"|"delivered"|"archived","media_bucket": "public-media"|"private-media","media_kind": "image"|"video"|"document","media_visibility": "private"|"public","payment_kind": "payment"|"refund","quote_status": "draft"|"sent"|"accepted"|"rejected"|"expired","review_status": "pending"|"approved"|"rejected","selection_status": "draft"|"submitted"|"locked","support_status": "open"|"pending"|"resolved"|"closed","upload_status": "pending"|"ready"|"failed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["owner", "admin", "staff", "customer"],"backup_status": ["running", "completed", "partial", "failed"],"booking_status": ["new", "contacted", "quoted", "confirmed", "cancelled", "declined"],"consent_status": ["none", "requested", "granted", "revoked"],"contract_status": ["draft", "sent", "approved", "void"],"deliverable_kind": ["gallery", "video", "album", "files"],"deliverable_status": ["in_progress", "review", "revision_requested", "approved", "delivered"],"equipment_status": ["available", "assigned", "maintenance", "retired"],"event_status": ["planned", "shooting", "editing", "delivered", "archived"],"media_bucket": ["public-media", "private-media"],"media_kind": ["image", "video", "document"],"media_visibility": ["private", "public"],"payment_kind": ["payment", "refund"],"quote_status": ["draft", "sent", "accepted", "rejected", "expired"],"review_status": ["pending", "approved", "rejected"],"selection_status": ["draft", "submitted", "locked"],"support_status": ["open", "pending", "resolved", "closed"],"upload_status": ["pending", "ready", "failed"]
          }
        }
} as const
