using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ServiceProcesgids.Api.Data.Entities;

namespace ServiceProcesgids.Api.Data;

/// <summary>
/// Afzonderlijke configuratie zodat de provider-neutrale migratie en het
/// runtime-model dezelfde limieten en concurrencygrens gebruiken.
/// </summary>
public sealed class AssuranceFrameworkDraftEntityConfiguration :
    IEntityTypeConfiguration<AssuranceFrameworkDraftEntity>
{
    public void Configure(EntityTypeBuilder<AssuranceFrameworkDraftEntity> entity)
    {
        entity.ToTable("AssuranceFrameworkDrafts");
        entity.HasKey(draft => draft.Id);
        entity.Property(draft => draft.Id).ValueGeneratedOnAdd();
        entity.Property(draft => draft.DraftId).HasMaxLength(32).IsRequired();
        entity.Property(draft => draft.TenantId).HasMaxLength(120).IsRequired();
        entity.Property(draft => draft.Status).HasMaxLength(30).IsRequired();
        entity.Property(draft => draft.FrameworkId).HasMaxLength(80).IsRequired();
        entity.Property(draft => draft.Name).HasMaxLength(160).IsRequired();
        entity.Property(draft => draft.Edition).HasMaxLength(160).IsRequired();
        entity.Property(draft => draft.Domain).HasMaxLength(180).IsRequired();
        entity.Property(draft => draft.SourceUrl).HasMaxLength(500).IsRequired();
        entity.Property(draft => draft.SourceOrganization).HasMaxLength(160).IsRequired();
        entity.Property(draft => draft.PublicSummary).HasMaxLength(4_000).IsRequired();
        entity.Property(draft => draft.QuestionsJson).IsRequired();
        entity.Property(draft => draft.SchemaVersion).HasMaxLength(80).IsRequired();
        entity.Property(draft => draft.Provider).HasMaxLength(80).IsRequired();
        entity.Property(draft => draft.Model).HasMaxLength(180).IsRequired();
        entity.Property(draft => draft.InputHash).HasMaxLength(80).IsRequired();
        entity.Property(draft => draft.OutputHash).HasMaxLength(80).IsRequired();
        entity.Property(draft => draft.CatalogUniquenessKey).HasMaxLength(260).IsRequired();
        entity.Property(draft => draft.CreatedByActorId).HasMaxLength(180).IsRequired();
        entity.Property(draft => draft.CreatedByActorName).HasMaxLength(220).IsRequired();
        entity.Property(draft => draft.PublishedByActorId).HasMaxLength(180);
        entity.Property(draft => draft.PublishedByActorName).HasMaxLength(220);
        entity.Property(draft => draft.RejectedByActorId).HasMaxLength(180);
        entity.Property(draft => draft.RejectedByActorName).HasMaxLength(220);
        entity.Property(draft => draft.RejectionReason).HasMaxLength(1_000);
        entity.Property(draft => draft.Revision).IsConcurrencyToken();
        entity.HasIndex(draft => draft.DraftId).IsUnique();
        entity.HasIndex(draft => draft.CatalogUniquenessKey).IsUnique();
        entity.HasIndex(draft => new { draft.TenantId, draft.Status, draft.Id });
        entity.HasIndex(draft => new { draft.TenantId, draft.FrameworkId });
    }
}
